(() => {
  const form = document.getElementById('createGroupForm');
  const legacyPrivate = document.getElementById('openPrivateJoin');
  if (legacyPrivate) legacyPrivate.closest('.private-entry')?.classList.add('hidden');
  if (!form) return;
  form.onsubmit = e => {
    e.preventDefault();
    if (!socket?.connected) return showToast('انتظر الاتصال بالسيرفر.');
    const btn = document.getElementById('confirmCreateGroup');
    btn.disabled = true;
    socket.emit('group:create', {
      name: document.getElementById('groupName').value.trim(),
      type: document.getElementById('groupType').value,
      image: groupImageData,
    }, r => {
      btn.disabled = false;
      if (!r?.ok) return showToast(r?.error || 'تعذر إنشاء المجموعة.');
      document.getElementById('createGroupModal').classList.add('hidden');
      window.SawalefShowInviteLink?.(r.group);
      joinRoomCode(r.group.roomId);
    });
  };
})();
