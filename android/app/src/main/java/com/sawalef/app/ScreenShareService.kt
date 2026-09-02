package com.sawalef.app

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.util.DisplayMetrics
import android.view.WindowManager
import io.livekit.android.ConnectOptions
import io.livekit.android.LiveKit
import io.livekit.android.RoomOptions
import io.livekit.android.audio.ScreenAudioCapturer
import io.livekit.android.room.Room
import io.livekit.android.room.participant.AudioTrackPublishOptions
import io.livekit.android.room.participant.VideoTrackPublishDefaults
import io.livekit.android.room.track.LocalAudioTrack
import io.livekit.android.room.track.LocalAudioTrackOptions
import io.livekit.android.room.track.LocalVideoTrackOptions
import io.livekit.android.room.track.Track
import io.livekit.android.room.track.VideoCaptureParameter
import io.livekit.android.room.track.VideoEncoding
import io.livekit.android.room.track.screencapture.ScreenCaptureParams
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import org.webrtc.audio.JavaAudioDeviceModule
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

class ScreenShareService : Service() {
    companion object {
        const val ACTION_START = "com.sawalef.app.action.START_SCREEN_SHARE"
        const val ACTION_STOP = "com.sawalef.app.action.STOP_SCREEN_SHARE"
        const val ACTION_STATUS = "com.sawalef.app.action.SCREEN_SHARE_STATUS"
        const val EXTRA_PROJECTION_DATA = "projectionData"
        const val EXTRA_URL = "livekitUrl"
        const val EXTRA_TOKEN = "livekitToken"
        const val EXTRA_QUALITY = "quality"
        const val EXTRA_FPS = "fps"
        const val EXTRA_AUDIO = "audio"
        const val EXTRA_STATE = "state"
        const val EXTRA_MESSAGE = "message"
        const val EXTRA_ACTUAL_FPS = "actualFps"
        const val EXTRA_ACTUAL_QUALITY = "actualQuality"
        private const val CHANNEL_ID = "sawalef_screen_share"
        private const val NOTIFICATION_ID = 52021
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var room: Room? = null
    private var screenAudioTrack: LocalAudioTrack? = null
    private var screenAudioCapturer: ScreenAudioCapturer? = null
    private var stopping = false
    private var started = false

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> scope.launch { stopSharing(notify = true) }
            ACTION_START -> startFromIntent(intent)
        }
        return START_NOT_STICKY
    }

    private fun startFromIntent(intent: Intent) {
        if (started) return
        val projectionData = if (Build.VERSION.SDK_INT >= 33) {
            intent.getParcelableExtra(EXTRA_PROJECTION_DATA, Intent::class.java)
        } else {
            @Suppress("DEPRECATION") intent.getParcelableExtra(EXTRA_PROJECTION_DATA)
        }
        val url = intent.getStringExtra(EXTRA_URL).orEmpty()
        val token = intent.getStringExtra(EXTRA_TOKEN).orEmpty()
        val quality = intent.getStringExtra(EXTRA_QUALITY).orEmpty().ifBlank { "1080" }
        val requestedFps = intent.getIntExtra(EXTRA_FPS, 60).coerceIn(15, 144)
        val shareAudio = intent.getBooleanExtra(EXTRA_AUDIO, true)

        if (projectionData == null || url.isBlank() || token.isBlank()) {
            sendStatus("error", "بيانات مشاركة الشاشة غير مكتملة.")
            stopSelf()
            return
        }

        val notification = buildNotification("جاري تشغيل مشاركة الشاشة…")
        if (Build.VERSION.SDK_INT >= 29) {
            var type = ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION
            if (shareAudio && checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                type = type or ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
            }
            startForeground(NOTIFICATION_ID, notification, type)
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }

        scope.launch {
            try {
                val size = captureSize(quality)
                val fps = requestedFps
                val bitrate = bitrateFor(quality, fps)
                val captureDefaults = LocalVideoTrackOptions(
                    isScreencast = true,
                    captureParams = VideoCaptureParameter(
                        width = size.first,
                        height = size.second,
                        maxFps = fps,
                        adaptOutputToDimensions = false,
                    ),
                )
                val publishDefaults = VideoTrackPublishDefaults(
                    videoEncoding = VideoEncoding(maxBitrate = bitrate, maxFps = fps),
                    simulcast = false,
                )
                val roomOptions = RoomOptions(
                    adaptiveStream = false,
                    dynacast = false,
                    screenShareTrackCaptureDefaults = captureDefaults,
                    screenShareTrackPublishDefaults = publishDefaults,
                )

                val nativeRoom = LiveKit.create(applicationContext, roomOptions)
                room = nativeRoom
                nativeRoom.connect(url, token, ConnectOptions(autoSubscribe = false))

                val params = ScreenCaptureParams(
                    mediaProjectionPermissionResultData = projectionData,
                    notificationId = NOTIFICATION_ID,
                    notification = buildNotification("شاشة الجوال قيد المشاركة"),
                    onStop = {
                        if (!stopping) scope.launch { stopSharing(notify = true) }
                    },
                )
                val enabled = nativeRoom.localParticipant.setScreenShareEnabled(true, params)
                if (!enabled) throw IllegalStateException("LiveKit رفض بدء مشاركة الشاشة.")

                if (shareAudio && Build.VERSION.SDK_INT >= 29 &&
                    checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                    startScreenAudio(nativeRoom)
                }

                started = true
                val manager = getSystemService(NotificationManager::class.java)
                manager.notify(NOTIFICATION_ID, buildNotification("شاشة الجوال قيد المشاركة"))
                sendStatus(
                    state = "started",
                    quality = "${size.first}×${size.second}",
                    fps = fps,
                )
            } catch (e: Throwable) {
                sendStatus("error", e.message ?: "تعذر تشغيل مشاركة شاشة Android.")
                stopSharing(notify = false)
            }
        }
    }

    private suspend fun startScreenAudio(nativeRoom: Room) {
        try {
            val screenTrack = nativeRoom.localParticipant.getTrackPublication(Track.Source.SCREEN_SHARE)?.track
                ?: return
            val capturer = ScreenAudioCapturer.createFromScreenShareTrack(screenTrack) ?: return
            capturer.gain = 1.0f

            // This participant exists only for screen sharing; disable physical microphone samples
            // so SCREEN_SHARE_AUDIO carries Android playback audio rather than duplicating the mic.
            (nativeRoom.lkObjects.audioDeviceModule as? JavaAudioDeviceModule)?.setAudioRecordEnabled(false)

            val audioTrack = nativeRoom.localParticipant.createAudioTrack(
                "sawalef-screen-audio",
                LocalAudioTrackOptions(
                    noiseSuppression = false,
                    echoCancellation = false,
                    autoGainControl = false,
                    highPassFilter = false,
                    typingNoiseDetection = false,
                ),
            )
            audioTrack.setAudioBufferCallback(capturer)
            val published = nativeRoom.localParticipant.publishAudioTrack(
                audioTrack,
                AudioTrackPublishOptions(
                    name = "sawalef-screen-audio",
                    audioBitrate = 192000,
                    dtx = false,
                    red = true,
                    source = Track.Source.SCREEN_SHARE_AUDIO,
                    stream = "sawalef-screen",
                ),
            )
            if (published) {
                screenAudioTrack = audioTrack
                screenAudioCapturer = capturer
            } else {
                audioTrack.setAudioBufferCallback(null)
                capturer.releaseAudioResources()
                audioTrack.dispose()
            }
        } catch (_: Throwable) {
            // Video sharing remains active even if a device/app does not allow playback capture.
        }
    }

    private fun captureSize(quality: String): Pair<Int, Int> {
        val metrics = DisplayMetrics()
        @Suppress("DEPRECATION")
        (getSystemService(WINDOW_SERVICE) as WindowManager).defaultDisplay.getRealMetrics(metrics)
        val rawW = max(1, metrics.widthPixels)
        val rawH = max(1, metrics.heightPixels)
        val requestedShort = when (quality) {
            "480" -> 480
            "720" -> 720
            "1080" -> 1080
            "1440" -> 1440
            "2160" -> 2160
            else -> min(rawW, rawH)
        }
        val rawShort = min(rawW, rawH)
        val scale = min(1.0, requestedShort.toDouble() / rawShort.toDouble())
        var w = max(2, (rawW * scale).roundToInt())
        var h = max(2, (rawH * scale).roundToInt())
        // Video encoders prefer even dimensions. Preserve the device's exact aspect ratio;
        // never crop a portrait phone into a 16:9 landscape rectangle.
        if (w % 2 != 0) w -= 1
        if (h % 2 != 0) h -= 1
        return Pair(max(2, w), max(2, h))
    }

    private fun bitrateFor(quality: String, fps: Int): Int {
        val base = when (quality) {
            "480" -> 2_500_000
            "720" -> 4_500_000
            "1080" -> 8_500_000
            "1440" -> 14_000_000
            "2160" -> 22_000_000
            else -> 9_000_000
        }
        val factor = (fps.toDouble() / 60.0).coerceIn(0.65, 2.1)
        return min(30_000_000, (base * factor).roundToInt())
    }

    private suspend fun stopSharing(notify: Boolean) {
        if (stopping) return
        stopping = true
        try {
            screenAudioTrack?.let { track ->
                try { track.setAudioBufferCallback(null) } catch (_: Throwable) {}
                try { room?.localParticipant?.unpublishTrack(track, true) } catch (_: Throwable) {}
            }
            screenAudioTrack = null
            try { screenAudioCapturer?.releaseAudioResources() } catch (_: Throwable) {}
            screenAudioCapturer = null
            try { room?.localParticipant?.setScreenShareEnabled(false) } catch (_: Throwable) {}
            try { room?.disconnect() } catch (_: Throwable) {}
            try { room?.release() } catch (_: Throwable) {}
            room = null
            started = false
            if (notify) sendStatus("stopped")
        } finally {
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
            stopping = false
        }
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT < 26) return
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(
            NotificationChannel(
                CHANNEL_ID,
                "مشاركة شاشة سوالف",
                NotificationManager.IMPORTANCE_LOW,
            ).apply {
                description = "يبقي مشاركة الشاشة والصوت فعالة عند الانتقال بين التطبيقات"
                setSound(null, null)
            },
        )
    }

    private fun buildNotification(text: String): Notification {
        val openIntent = packageManager.getLaunchIntentForPackage(packageName)
        val openPending = PendingIntent.getActivity(
            this,
            1,
            openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val stopIntent = Intent(this, ScreenShareService::class.java).setAction(ACTION_STOP)
        val stopPending = PendingIntent.getService(
            this,
            2,
            stopIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val builder = if (Build.VERSION.SDK_INT >= 26) {
            Notification.Builder(this, CHANNEL_ID)
        } else {
            @Suppress("DEPRECATION") Notification.Builder(this)
        }
        return builder
            .setSmallIcon(android.R.drawable.ic_menu_share)
            .setContentTitle("سوالف • مشاركة الشاشة")
            .setContentText(text)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setCategory(Notification.CATEGORY_SERVICE)
            .setContentIntent(openPending)
            .addAction(android.R.drawable.ic_menu_close_clear_cancel, "إيقاف المشاركة", stopPending)
            .build()
    }

    private fun sendStatus(
        state: String,
        message: String = "",
        quality: String = "",
        fps: Int = 0,
    ) {
        sendBroadcast(
            Intent(ACTION_STATUS)
                .setPackage(packageName)
                .putExtra(EXTRA_STATE, state)
                .putExtra(EXTRA_MESSAGE, message)
                .putExtra(EXTRA_ACTUAL_QUALITY, quality)
                .putExtra(EXTRA_ACTUAL_FPS, fps),
        )
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        // Switching apps keeps sharing. Explicitly swiping Sawalef away stops capture for privacy.
        scope.launch { stopSharing(notify = true) }
        super.onTaskRemoved(rootIntent)
    }

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }
}
