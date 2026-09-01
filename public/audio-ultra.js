(() => {
  // Legacy P2P audio tuning used to monkey-patch RTCPeerConnection.createOffer/createAnswer.
  // LiveKit owns its WebRTC negotiation, so changing the global SDP breaks SFU audio on some browsers.
  // Keep this file as a compatibility placeholder because older cached HTML may still request it.
  window.SawalefLegacyAudioUltraDisabled = true;
})();
