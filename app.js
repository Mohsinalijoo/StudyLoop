(() => {
  'use strict';

  const api = window.StudyloopAPI;
  const auth = window.StudyloopAuth;
  const realtime = window.StudyloopRealtime;
  const toast = document.getElementById('toast');
  const callModal = document.getElementById('callModal');
  const sessionDock = document.getElementById('sessionDock');
  const boardModal = document.getElementById('boardModal');
  const profileModal = document.getElementById('profileModal');
  const studentGrid = document.getElementById('studentGrid');
  const searchForm = document.getElementById('searchForm');
  const searchInput = document.getElementById('studentSearch');
  const subjectFilter = document.getElementById('subjectFilter');
  const availabilityFilter = document.getElementById('availabilityFilter');
  const resultsLabel = document.getElementById('resultsLabel');
  const onlineCount = document.getElementById('onlineCount');
  const emptyState = document.getElementById('emptyState');
  const emptyStateTitle = document.getElementById('emptyStateTitle');
  const emptyStateText = document.getElementById('emptyStateText');
  const roomGrid = document.getElementById('roomGrid');
  const roomsStatus = document.getElementById('roomsStatus');
  const roomCreateForm = document.getElementById('roomCreateForm');
  const roomLookupForm = document.getElementById('roomLookupForm');
  const roomSearchResult = document.getElementById('roomSearchResult');
  const matchStatus = document.getElementById('matchStatus');
  const incomingRequestsList = document.getElementById('incomingRequests');
  const outgoingRequestsList = document.getElementById('outgoingRequests');
  const matchStatusText = document.getElementById('matchStatusText');
  const cancelMatchButton = document.getElementById('cancelMatchButton');
  const startMatchButton = document.getElementById('startMatchButton');
  const stagePerson = document.getElementById('stagePerson');
  const remoteVideoGrid = document.getElementById('remoteVideoGrid');
  const localVideo = document.getElementById('localVideo');

  let activeModal = null;
  let lastFocusedElement = null;
  let toastTimeout = null;
  let currentUser = null;
  let students = [];
  let activeSession = null;
  let currentMicOn = false;
  let currentCameraOn = false;
  let localMediaStream = null;
  let localAudioTrack = null;
  let localVideoTrack = null;
  const peerConnections = new Map();
  const remoteTiles = new Map();
  const rtcConfiguration = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
  let searchDebounce = null;
  let matchPollTimer = null;
  let searchRequestNumber = 0;
  let roomRequestNumber = 0;
  let studyRequestLoadNumber = 0;
  let currentStudyRequests = { incoming: [], outgoing: [] };
  let activeRooms = [];
  let searchedRoomId = '';
  let socket = null;

  const escapeHTML = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);

  function initialsFor(name = 'S') {
    return String(name).trim().split(/\s+/).slice(0, 2).map((part) => part[0] || '').join('').toUpperCase() || 'S';
  }

  function avatarFor(id = '') {
    const variants = ['avatar-lavender', 'avatar-peach', 'avatar-mint', 'avatar-yellow'];
    let hash = 0;
    for (const character of String(id)) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
    return variants[hash % variants.length];
  }

  function showToast(message) {
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('is-visible');
    window.clearTimeout(toastTimeout);
    toastTimeout = window.setTimeout(() => toast.classList.remove('is-visible'), 3600);
  }

  function openModal(modal) {
    if (!modal) return;
    if (activeModal && activeModal !== modal) activeModal.hidden = true;
    if (modal === callModal && sessionDock) sessionDock.hidden = true;
    lastFocusedElement = document.activeElement;
    activeModal = modal;
    modal.hidden = false;
    document.body.classList.add('modal-open');
    const closeButton = modal.querySelector('[data-close-modal]');
    if (closeButton) window.setTimeout(() => closeButton.focus(), 20);
  }

  function closeModal() {
    if (!activeModal) return;
    activeModal.hidden = true;
    activeModal = null;
    document.body.classList.remove('modal-open');
    if (lastFocusedElement && typeof lastFocusedElement.focus === 'function') lastFocusedElement.focus();
  }

  function minimizeCallSession() {
    if (!activeSession) {
      closeModal();
      return;
    }
    callModal.hidden = true;
    if (activeModal === callModal) activeModal = null;
    document.body.classList.remove('modal-open');
    sessionDock.hidden = false;
    const title = activeSession.room?.title || 'Active study session';
    document.getElementById('sessionDockTitle').textContent = title;
  }

  function restoreCallSession() {
    if (!activeSession) return;
    openModal(callModal);
  }

  function openBoard() { openModal(boardModal); }
  window.StudyloopApp = Object.freeze({ showToast, openBoard });

  function setMatchStatus(message, waiting = false) {
    matchStatus.hidden = !message;
    matchStatusText.textContent = message || '';
    cancelMatchButton.hidden = !waiting;
    startMatchButton.disabled = waiting;
  }

  function friendlyError(error) {
    if (error?.status === 401) return 'Your session expired. Please log in again.';
    if (error?.status === 403) return error.message || 'You do not have access to this room.';
    if (error?.status === 409 && error.code === 'ROOM_FULL') return 'That room is full. Try another room.';
    if (error?.status === 0 || error?.code === 'NETWORK_ERROR') return 'The API is unavailable. Check the backend and try again.';
    return error?.message || 'Something went wrong. Please try again.';
  }

  function reportError(error) {
    showToast(friendlyError(error));
  }

  function populateSubjectSelect(select, values, includeAll = false) {
    if (!select) return;
    const current = select.value;
    select.replaceChildren();
    if (includeAll) select.add(new Option('All fields of study', 'all'));
    for (const value of [...new Set(values.filter((item) => typeof item === 'string' && item.trim()))]) {
      select.add(new Option(value, value));
    }
    if (current && [...select.options].some((option) => option.value === current)) select.value = current;
    else if (includeAll) select.value = 'all';
  }

  function syncProfileSubjects() {
    const subjects = currentUser?.subjects || [];
    populateSubjectSelect(subjectFilter, subjects, true);
    populateSubjectSelect(document.getElementById('roomSubject'), subjects, false);
  }

  function renderStudent(student) {
    const topics = student.subjects.map((subject) => `<span class="student-tag">${escapeHTML(subject)}</span>`).join('');
    const availability = student.availability === 'now' ? 'Free now' : student.availability === 'later' ? 'Available later' : 'Flexible schedule';
    const presenceText = student.online ? 'Online now' : 'Offline';
    const bio = student.bio ? `<p class="student-bio">${escapeHTML(student.bio)}</p>` : '';
    const sharedSubject = student.subjects.find((item) => currentUser.subjects.some((mine) => mine.toLocaleLowerCase() === item.toLocaleLowerCase())) || '';
    const requestSubject = sharedSubject || currentUser.subjects?.[0] || student.subjects[0] || 'General study';
    const hasPendingRequest = currentStudyRequests.outgoing.some((request) => request.kind === 'direct'
      && request.status === 'pending' && request.toUser?.id === student.id);
    const requestLabel = hasPendingRequest ? 'Study request sent' : 'Send study request';
    return `
      <article class="student-card">
        <div class="student-card-top">
          <div class="avatar student-card-avatar ${student.avatar}" aria-hidden="true">${escapeHTML(student.initials)}</div>
          <span class="student-presence ${student.online ? 'is-online' : ''}"><span class="online-dot ${student.online ? '' : 'is-away'}"></span>${presenceText}</span>
        </div>
        <h3>${escapeHTML(student.name)}</h3>
        <p class="student-major">${escapeHTML(student.subjects.join(' · ') || 'Studyloop member')}</p>
        ${bio}
        <div class="student-tags">${topics}</div>
        <div class="student-availability"><span class="online-dot ${student.online ? '' : 'is-away'}"></span><span>${availability}</span></div>
        <div class="student-actions">
          <button class="invite-button" type="button" data-action="study-request" data-user-id="${escapeHTML(student.id)}" data-subject="${escapeHTML(requestSubject)}" ${hasPendingRequest ? 'disabled' : ''}>
            ${requestLabel} <span aria-hidden="true">→</span>
          </button>
        </div>
      </article>`;
  }

  function renderStudents() {
    const onlineMatches = students.filter((student) => student.online).length;
    studentGrid.innerHTML = students.map(renderStudent).join('');
    studentGrid.hidden = students.length === 0;
    emptyState.hidden = students.length !== 0;
    onlineCount.textContent = `${onlineMatches} ${onlineMatches === 1 ? 'student' : 'students'}`;
    resultsLabel.textContent = students.length
      ? `${students.length} ${students.length === 1 ? 'member' : 'members'} match your filters`
      : 'No matching members';
    if (!students.length) {
      emptyStateTitle.textContent = searchInput.value || subjectFilter.value !== 'all' || availabilityFilter.value !== 'any'
        ? 'No members match those filters'
        : 'No other members yet';
      emptyStateText.textContent = subjectFilter.value === 'all'
        ? 'No other members match those filters yet. Try a different search or check back later.'
        : 'Try a different study field, availability, or search term, or check back later.';
    }
  }

  async function loadStudents() {
    const requestNumber = ++searchRequestNumber;
    const params = new URLSearchParams({ limit: '100', page: '1' });
    const query = searchInput.value.trim();
    const subject = subjectFilter.value;
    const availability = availabilityFilter.value;
    if (query) params.set('q', query);
    if (subject !== 'all') params.set('subject', subject);
    if (availability === 'now') params.set('online', 'true');
    if (availability === 'later') params.set('availability', 'later');
    resultsLabel.textContent = 'Loading Studyloop members…';
    try {
      const users = await api.request(`/users?${params}`);
      if (requestNumber !== searchRequestNumber) return;
      students = (Array.isArray(users) ? users : [])
        .filter((user) => user.id !== currentUser.id)
        .map((user) => ({
          id: user.id,
          name: user.displayName,
          initials: initialsFor(user.displayName),
          subjects: Array.isArray(user.subjects) ? user.subjects : [],
          availability: user.availability || 'flexible',
          online: Boolean(user.online),
          bio: user.bio || '',
          avatar: avatarFor(user.id)
        }));
      renderStudents();
    } catch (error) {
      if (requestNumber !== searchRequestNumber) return;
      resultsLabel.textContent = 'Could not load members';
      students = [];
      renderStudents();
      reportError(error);
    }
  }

  function roomMember(member) {
    if (member && typeof member === 'object') {
      return { id: String(member.id || member._id || ''), name: member.displayName || member.name || 'Studyloop member' };
    }
    return { id: String(member || ''), name: 'Studyloop member' };
  }

  function renderSessionMembers() {
    const list = document.getElementById('sessionMembersList');
    const count = document.getElementById('sessionMemberCount');
    if (!list || !count) return;
    if (!activeSession) {
      list.replaceChildren();
      count.textContent = '0';
      return;
    }
    const membersById = new Map();
    membersById.set(String(currentUser.id), { id: String(currentUser.id), name: currentUser.displayName || 'You' });
    for (const member of activeSession.participants || []) {
      const normalized = roomMember(member);
      if (normalized.id) membersById.set(normalized.id, normalized);
    }
    const members = [...membersById.values()];
    count.textContent = String(members.length);
    list.innerHTML = members.map((member) => {
      const self = member.id === String(currentUser.id);
      const state = self
        ? { micEnabled: currentMicOn, cameraEnabled: currentCameraOn }
        : (activeSession.mediaStates?.[member.id] || { micEnabled: false, cameraEnabled: false });
      return `<li class="session-member-row"><span class="avatar session-member-avatar ${avatarFor(member.id)}">${escapeHTML(initialsFor(member.name))}</span><span class="session-member-name">${escapeHTML(member.name)}${self ? ' <small>(you)</small>' : ''}</span><span class="member-media-pill ${state.micEnabled ? 'is-on' : ''}" title="Microphone ${state.micEnabled ? 'on' : 'off'}">${state.micEnabled ? '🎙 Mic on' : 'Mic off'}</span><span class="member-media-pill ${state.cameraEnabled ? 'is-on' : ''}" title="Camera ${state.cameraEnabled ? 'on' : 'off'}">${state.cameraEnabled ? '▣ Cam on' : 'Cam off'}</span></li>`;
    }).join('');
  }

  function renderRoomJoinRequests() {
    const panel = document.getElementById('roomJoinRequestsPanel');
    const list = document.getElementById('roomJoinRequests');
    const count = document.getElementById('roomJoinRequestCount');
    if (!panel || !list || !count) return;
    const isOwner = activeSession?.room?.type === 'group' && activeSession.room.hostId === currentUser?.id;
    const requests = isOwner
      ? (currentStudyRequests.incoming || []).filter((request) => request.kind === 'room'
        && request.status === 'pending' && request.roomId === activeSession.roomId)
      : [];
    panel.hidden = requests.length === 0;
    count.textContent = `${requests.length} ${requests.length === 1 ? 'request' : 'requests'}`;
    list.innerHTML = requests.map(renderIncomingStudyRequest).join('');
  }

  function renderRoom(room, index) {
    const colors = ['violet', 'peach', 'mint'];
    const art = [
      '<span class="room-sun"></span><span class="book book-one"></span><span class="book book-two"></span><span class="book book-three"></span><span class="room-plant">✳</span>',
      '<span class="study-paper paper-one"></span><span class="study-paper paper-two"></span><span class="study-pencil"></span><span class="study-star">✦</span>',
      '<span class="cloud-shape cloud-one"></span><span class="cloud-shape cloud-two"></span><span class="cloud-star star-one">✦</span><span class="cloud-star star-two">✳</span><span class="cloud-line"></span>'
    ];
    const artClasses = ['room-art-library', 'room-art-study', 'room-art-cloud'];
    const members = (room.members || []).map(roomMember);
    const isMember = members.some((member) => member.id === currentUser.id);
    const isOwner = room.hostId === currentUser.id;
    const full = room.memberCount >= room.capacity && !isMember;
    const closed = room.status !== 'active';
    const pendingRequest = currentStudyRequests.outgoing.find((request) => request.kind === 'room'
      && request.status === 'pending' && request.roomId === room.id);
    const avatars = members.slice(0, 3).map((member) => `<span class="avatar avatar-room ${avatarFor(member.id)}" title="${escapeHTML(member.name)}">${escapeHTML(initialsFor(member.name))}</span>`).join('');
    const spots = Math.max(0, room.capacity - room.memberCount);
    const label = closed ? 'Room closed' : pendingRequest ? 'Request pending' : full ? 'Room full' : isMember || isOwner ? 'Open room' : 'Request to join';
    const disabled = closed || pendingRequest || full;
    const action = isMember || isOwner ? 'open-room' : 'request-room';
    return `
      <article class="room-card room-card-${colors[index % colors.length]}">
        <div class="room-card-top"><span class="room-category">${escapeHTML(room.subject)} · ${room.type === 'pair' ? '1:1' : 'GROUP'}</span><span class="room-live"><span class="live-dot"></span> ${room.memberCount}/${room.capacity}</span></div>
        <div class="room-art ${artClasses[index % artClasses.length]}" aria-hidden="true">${art[index % art.length]}</div>
        <h3>${escapeHTML(room.title)}</h3><p>${escapeHTML(room.subject)} · ${spots ? `${spots} ${spots === 1 ? 'seat' : 'seats'} open` : 'At capacity'}</p>
        <div class="room-id-row"><span>ROOM ID</span><code>${escapeHTML(room.id)}</code><button type="button" data-copy-room-id="${escapeHTML(room.id)}" aria-label="Copy room ID ${escapeHTML(room.id)}">Copy</button></div>
        <div class="room-card-bottom"><div class="room-avatars" aria-label="${room.memberCount} of ${room.capacity} members">${avatars}<span class="room-people">${room.memberCount} studying</span></div><button class="room-join" type="button" data-room-id="${escapeHTML(room.id)}" data-room-action="${action}" ${disabled ? 'disabled' : ''}>${label} <span aria-hidden="true">↗</span></button></div>
      </article>`;
  }

  async function loadRooms() {
    const requestNumber = ++roomRequestNumber;
    roomsStatus.textContent = 'Loading active rooms…';
    try {
      const rooms = await api.request('/rooms?limit=50');
      if (requestNumber !== roomRequestNumber) return;
      activeRooms = Array.isArray(rooms) ? rooms : [];
      roomGrid.innerHTML = activeRooms.map(renderRoom).join('');
      roomsStatus.textContent = activeRooms.length ? `${activeRooms.length} active ${activeRooms.length === 1 ? 'room' : 'rooms'}` : 'No active rooms yet. Create one to get started.';
    } catch (error) {
      if (requestNumber !== roomRequestNumber) return;
      roomsStatus.textContent = 'Could not load rooms.';
      activeRooms = [];
      roomGrid.replaceChildren();
      reportError(error);
    }
  }

  function renderIncomingStudyRequest(request) {
    const sender = request.fromUser?.displayName || 'A Studyloop student';
    const isRoomRequest = request.kind === 'room';
    const roomTitle = request.room?.title || 'a study room';
    const detail = isRoomRequest
      ? `Wants to join ${escapeHTML(roomTitle)} · ${escapeHTML(request.subject)}`
      : `Wants to study with you · ${escapeHTML(request.subject)}`;
    const title = isRoomRequest ? `${escapeHTML(sender)} requested to join your room` : `${escapeHTML(sender)} wants a 1:1 study session`;
    const approveLabel = isRoomRequest ? 'Approve & add' : 'Accept & open session';
    return `
      <article class="study-request-card">
        <div class="study-request-card-top"><span class="request-kind">${isRoomRequest ? 'ROOM JOIN' : '1:1 STUDY'}</span><span class="request-state request-state-pending">Pending</span></div>
        <h4>${title}</h4>
        <p>${detail}</p>
        ${isRoomRequest && request.room?.id ? `<div class="request-room-id">Room ID <code>${escapeHTML(request.room.id)}</code></div>` : ''}
        <time datetime="${escapeHTML(request.createdAt || '')}">${escapeHTML(formatTime(request.createdAt))}</time>
        <div class="study-request-actions">
          <button class="button button-primary" type="button" data-request-action="accept" data-request-id="${escapeHTML(request.id)}">${approveLabel}</button>
          <button class="button button-quiet" type="button" data-request-action="decline" data-request-id="${escapeHTML(request.id)}">Decline</button>
        </div>
      </article>`;
  }

  function renderOutgoingStudyRequest(request) {
    const recipient = request.toUser?.displayName || 'Studyloop student';
    const isRoomRequest = request.kind === 'room';
    const roomTitle = request.room?.title || 'a study room';
    const detail = isRoomRequest
      ? `Join request for ${escapeHTML(roomTitle)} · ${escapeHTML(request.subject)}`
      : `1:1 study request · ${escapeHTML(request.subject)}`;
    const labels = { pending: 'Pending', accepted: 'Accepted', declined: 'Declined', expired: 'Expired' };
    const state = labels[request.status] || 'Updated';
    const openRoom = request.status === 'accepted' && request.resultRoom?.id
      ? `<button class="button button-outline" type="button" data-open-room-id="${escapeHTML(request.resultRoom.id)}">Open ${request.kind === 'direct' ? 'session' : 'room'} <span aria-hidden="true">↗</span></button>`
      : '';
    const cancel = request.status === 'pending'
      ? `<button class="button button-quiet" type="button" data-request-action="cancel" data-request-id="${escapeHTML(request.id)}">Cancel request</button>`
      : '';
    return `
      <article class="study-request-card study-request-card-sent">
        <div class="study-request-card-top"><span class="request-kind">${isRoomRequest ? 'ROOM JOIN' : '1:1 STUDY'}</span><span class="request-state request-state-${escapeHTML(request.status)}">${state}</span></div>
        <h4>${isRoomRequest ? `Room owner · ${escapeHTML(recipient)}` : escapeHTML(recipient)}</h4>
        <p>${detail}</p>
        <time datetime="${escapeHTML(request.createdAt || '')}">${escapeHTML(formatTime(request.createdAt))}</time>
        <div class="study-request-actions">${openRoom}${cancel}</div>
      </article>`;
  }

  function renderStudyRequests() {
    const incoming = currentStudyRequests.incoming || [];
    const outgoing = currentStudyRequests.outgoing || [];
    const incomingCount = document.getElementById('incomingRequestCount');
    const outgoingCount = document.getElementById('outgoingRequestCount');
    const requestSummary = document.getElementById('requestSummary');
    const requestBadge = document.getElementById('requestCountBadge');
    incomingCount.textContent = String(incoming.length);
    outgoingCount.textContent = String(outgoing.length);
    requestBadge.textContent = String(incoming.length);
    requestBadge.hidden = incoming.length === 0;
    requestSummary.textContent = incoming.length
      ? `${incoming.length} request${incoming.length === 1 ? '' : 's'} waiting for your response`
      : 'You’re all caught up';
    incomingRequestsList.innerHTML = incoming.length
      ? incoming.map(renderIncomingStudyRequest).join('')
      : '<p class="request-empty">No incoming requests right now.</p>';
    outgoingRequestsList.innerHTML = outgoing.length
      ? outgoing.map(renderOutgoingStudyRequest).join('')
      : '<p class="request-empty">You have not sent any study requests yet.</p>';
    renderStudents();
    renderRoomJoinRequests();
  }

  async function loadStudyRequests() {
    const requestNumber = ++studyRequestLoadNumber;
    try {
      const result = await api.request('/study-requests');
      if (requestNumber !== studyRequestLoadNumber) return;
      currentStudyRequests = {
        incoming: Array.isArray(result.incoming) ? result.incoming : [],
        outgoing: Array.isArray(result.outgoing) ? result.outgoing : []
      };
      renderStudyRequests();
      roomGrid.innerHTML = activeRooms.map(renderRoom).join('');
    } catch (error) {
      if (requestNumber !== studyRequestLoadNumber) return;
      document.getElementById('requestSummary').textContent = 'Could not load requests';
      incomingRequestsList.innerHTML = '<p class="request-empty">Could not load incoming requests.</p>';
      outgoingRequestsList.innerHTML = '<p class="request-empty">Could not load sent requests.</p>';
      reportError(error);
    }
  }

  async function sendDirectStudyRequest(button) {
    const toUserId = button.dataset.userId;
    const subject = button.dataset.subject || currentUser.subjects?.[0] || 'General study';
    const originalText = button.textContent.trim();
    button.disabled = true;
    button.textContent = 'Sending request…';
    try {
      const result = await api.request('/study-requests/direct', {
        method: 'POST',
        body: { toUserId, subject }
      });
      const recipientName = students.find((student) => student.id === toUserId)?.name || 'that student';
      showToast(result.alreadyPending ? `Your request to ${recipientName} is still pending.` : `Study request sent to ${recipientName}.`);
      await loadStudyRequests();
    } catch (error) {
      reportError(error);
      button.disabled = false;
      button.textContent = originalText || 'Send study request';
    }
  }

  async function respondToStudyRequest(requestId, action, button) {
    if (!requestId) return;
    const originalText = button?.textContent || '';
    if (button) {
      button.disabled = true;
      if (action === 'accept') button.textContent = 'Opening…';
      else if (action === 'decline') button.textContent = 'Declining…';
      else button.textContent = 'Cancelling…';
    }
    try {
      const result = action === 'cancel'
        ? await api.request(`/study-requests/${encodeURIComponent(requestId)}`, { method: 'DELETE' })
        : await api.request(`/study-requests/${encodeURIComponent(requestId)}/${action}`, { method: 'POST', body: {} });
      await loadStudyRequests();
      if (action === 'accept' && result.resultRoom?.id) {
        await loadRooms();
        await openRoomById(result.resultRoom.id);
      } else if (action === 'decline') {
        showToast('Request declined.');
      } else if (action === 'cancel') {
        showToast('Study request cancelled.');
      }
      if (searchedRoomId) void lookupRoomById(searchedRoomId, false);
    } catch (error) {
      reportError(error);
      if (button) {
        button.disabled = false;
        button.textContent = originalText;
      }
    }
  }

  function setRoomLookupFeedback(message, isError = false) {
    const feedback = document.getElementById('roomLookupFeedback');
    feedback.textContent = message;
    feedback.hidden = !message;
    feedback.classList.toggle('is-error', isError);
  }

  async function lookupRoomById(value, showFeedback = true) {
    const roomId = String(value || '').trim().toLowerCase();
    if (!/^[a-f0-9]{24}$/.test(roomId)) {
      searchedRoomId = '';
      roomSearchResult.hidden = true;
      if (showFeedback) setRoomLookupFeedback('Enter a valid 24-character room ID.', true);
      return;
    }
    try {
      const result = await api.request(`/rooms/${encodeURIComponent(roomId)}`);
      if (!result?.room?.id) throw new Error('Room not found. Double-check the ID and try again.');
      searchedRoomId = result.room.id;
      roomSearchResult.innerHTML = renderRoom(result.room, 0);
      roomSearchResult.hidden = false;
      if (showFeedback) setRoomLookupFeedback('Room found. Send a request to the owner to join.');
    } catch (error) {
      searchedRoomId = '';
      roomSearchResult.hidden = true;
      if (showFeedback) setRoomLookupFeedback(friendlyError(error), true);
    }
  }

  async function sendRoomJoinRequest(roomId, button) {
    const originalText = button?.textContent || '';
    if (button) {
      button.disabled = true;
      button.textContent = 'Sending request…';
    }
    try {
      const result = await api.request(`/study-requests/rooms/${encodeURIComponent(roomId)}`, { method: 'POST', body: {} });
      showToast(result.alreadyPending ? 'Your room request is still pending.' : 'Join request sent to the room owner.');
      await Promise.all([loadStudyRequests(), loadRooms()]);
      if (searchedRoomId) await lookupRoomById(searchedRoomId, false);
    } catch (error) {
      reportError(error);
      if (button) {
        button.disabled = false;
        button.textContent = originalText || 'Request to join';
      }
    }
  }

  async function copyRoomId(button) {
    const roomId = button.dataset.copyRoomId;
    try {
      await navigator.clipboard.writeText(roomId);
      showToast('Room ID copied. Share it with the people you want to invite.');
    } catch {
      showToast(`Room ID: ${roomId}`);
    }
  }

  function setRoomFeedback(message, isError = false) {
    const feedback = document.getElementById('roomCreateFeedback');
    feedback.textContent = message;
    feedback.hidden = !message;
    feedback.classList.toggle('is-error', isError);
  }

  function formatTime(value) {
    const date = value ? new Date(value) : new Date();
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }

  function appendChatNotice(message) {
    const list = document.getElementById('chatMessages');
    const notice = document.createElement('div');
    notice.className = 'chat-system-message';
    notice.textContent = message;
    list.appendChild(notice);
    list.scrollTop = list.scrollHeight;
  }

  function appendChatMessage(message, forceMine = false) {
    const list = document.getElementById('chatMessages');
    const sender = message.sender || {};
    const senderId = String(sender.id || sender._id || message.senderId || '');
    const senderName = sender.displayName || message.senderName || 'Studyloop member';
    const mine = forceMine || senderId === currentUser.id;
    const row = document.createElement('div');
    row.className = `chat-message${mine ? ' chat-message--mine' : ''}`;
    if (!mine) {
      const face = document.createElement('span');
      face.className = `avatar chat-message-avatar ${avatarFor(senderId)}`;
      face.setAttribute('aria-hidden', 'true');
      face.textContent = initialsFor(senderName);
      row.appendChild(face);
    }
    const body = document.createElement('div');
    body.className = 'chat-message-body';
    const meta = document.createElement('div');
    meta.className = 'chat-message-meta';
    const name = document.createElement('strong');
    name.textContent = mine ? 'You' : senderName;
    const timestamp = document.createElement('time');
    timestamp.textContent = formatTime(message.createdAt);
    meta.append(name, timestamp);
    const bubble = document.createElement('p');
    bubble.className = 'chat-bubble';
    bubble.textContent = message.body || '';
    body.append(meta, bubble);
    row.appendChild(body);
    list.appendChild(row);
    list.scrollTop = list.scrollHeight;
  }

  async function loadRoomMessages(roomId) {
    const list = document.getElementById('chatMessages');
    list.replaceChildren();
    appendChatNotice('Loading saved room messages…');
    try {
      const messages = await api.request(`/rooms/${encodeURIComponent(roomId)}/messages?limit=50`);
      if (!activeSession || activeSession.roomId !== roomId) return;
      list.replaceChildren();
      if (!messages.length) appendChatNotice('No messages yet. Start the conversation.');
      messages.forEach((message) => appendChatMessage(message));
    } catch (error) {
      if (!activeSession || activeSession.roomId !== roomId) return;
      list.replaceChildren();
      appendChatNotice(friendlyError(error));
    }
  }

  function updateSelfMediaPreview() {
    const cameraReady = Boolean(currentCameraOn && localVideoTrack?.readyState === 'live');
    const selfAvatar = document.getElementById('selfAvatar');
    const selfMediaLabel = document.getElementById('selfMediaLabel');
    const selfCameraDot = document.getElementById('selfCameraDot');
    if (currentUser) selfAvatar.textContent = initialsFor(currentUser.displayName);
    localVideo.hidden = !cameraReady;
    selfAvatar.hidden = cameraReady;
    if (cameraReady && localMediaStream) {
      if (localVideo.srcObject !== localMediaStream) localVideo.srcObject = localMediaStream;
      localVideo.play().catch(() => {});
    }
    selfMediaLabel.textContent = currentCameraOn
      ? 'Camera on'
      : currentMicOn ? 'Mic on · camera off' : 'Camera and mic off';
    selfCameraDot.style.background = currentCameraOn ? '#6bc493' : '#c6c2d6';
  }

  function mediaAccessMessage(error, kind) {
    if (error?.name === 'NotAllowedError' || error?.name === 'PermissionDeniedError') {
      return `Allow ${kind} access in your browser's site settings, then try again.`;
    }
    if (error?.name === 'NotFoundError' || error?.name === 'DevicesNotFoundError') {
      return `No ${kind} device was found. Check that one is connected and try again.`;
    }
    if (error?.name === 'NotReadableError' || error?.name === 'TrackStartError') {
      return `Your ${kind} device may be busy in another app. Close other apps using it and try again.`;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      return 'Browser media access is unavailable. Open Studyloop on localhost or over HTTPS.';
    }
    return error?.message || `Could not start your ${kind}. Check browser permissions and try again.`;
  }

  async function ensureLocalTrack(kind) {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Browser media access is unavailable. Open Studyloop on localhost or over HTTPS.');
    }
    let track = kind === 'audio' ? localAudioTrack : localVideoTrack;
    if (track?.readyState === 'live') return track;

    const previousTrack = track;
    const constraints = kind === 'audio'
      ? { audio: true, video: false }
      : { audio: false, video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 360 } } };
    const capturedStream = await navigator.mediaDevices.getUserMedia(constraints);
    track = capturedStream.getTracks().find((item) => item.kind === kind);
    if (!track) throw new Error(`The browser did not provide a ${kind} track.`);
    if (!localMediaStream) localMediaStream = new MediaStream();
    if (previousTrack && previousTrack.readyState !== 'live') localMediaStream.removeTrack(previousTrack);
    localMediaStream.addTrack(track);
    track.enabled = true;
    if (kind === 'audio') localAudioTrack = track;
    else localVideoTrack = track;

    track.addEventListener('ended', () => {
      if (kind === 'audio' && localAudioTrack === track) {
        currentMicOn = false;
        updateCallControl(document.getElementById('micControl'), false, 'Mic on');
        void sendMediaToggle('mic_toggle', false).catch(() => {});
      }
      if (kind === 'video' && localVideoTrack === track) {
        currentCameraOn = false;
        updateCallControl(document.getElementById('cameraControl'), false, 'Camera on');
        void sendMediaToggle('camera_toggle', false).catch(() => {});
      }
      renderSessionMembers();
      updateSelfMediaPreview();
    }, { once: true });

    for (const peer of peerConnections.values()) {
      if (peer.pc.signalingState === 'closed') continue;
      const sender = peer.pc.getSenders().find((item) => item.track?.kind === kind);
      if (sender) await sender.replaceTrack(track);
      else peer.pc.addTrack(track, localMediaStream);
    }
    updateSelfMediaPreview();
    return track;
  }

  function updateRemoteVideoGrid() {
    remoteVideoGrid.dataset.count = String(remoteTiles.size);
    remoteVideoGrid.hidden = remoteTiles.size === 0;
    stagePerson.hidden = remoteTiles.size > 0;
  }

  function ensureRemoteTile(peerId) {
    if (!activeSession || !peerId || peerId === currentUser.id) return null;
    let tile = remoteTiles.get(peerId);
    const participant = activeSession.participants.find((item) => item.id === peerId);
    const name = participant?.name || 'Studyloop member';
    if (tile) {
      tile.name.textContent = name;
      return tile;
    }

    const element = document.createElement('div');
    element.className = 'remote-video-tile';
    element.dataset.peerId = peerId;
    const video = document.createElement('video');
    video.autoplay = true;
    video.playsInline = true;
    video.setAttribute('aria-label', `${name}'s live audio and video`);
    const avatar = document.createElement('span');
    avatar.className = `avatar remote-video-avatar ${avatarFor(peerId)}`;
    avatar.setAttribute('aria-hidden', 'true');
    avatar.textContent = initialsFor(name);
    const nameLabel = document.createElement('span');
    nameLabel.className = 'remote-video-name';
    nameLabel.textContent = name;
    const stateLabel = document.createElement('span');
    stateLabel.className = 'remote-video-state';
    stateLabel.textContent = 'Waiting for media';
    element.append(video, avatar, nameLabel, stateLabel);
    remoteVideoGrid.appendChild(element);
    tile = { element, video, avatar, name: nameLabel, state: stateLabel, remoteStream: null, micEnabled: null, cameraEnabled: null };
    remoteTiles.set(peerId, tile);
    updateRemoteVideoGrid();
    return tile;
  }

  function updateRemoteMediaState(peerId, kind, enabled) {
    const tile = ensureRemoteTile(peerId);
    if (!tile) return;
    activeSession.mediaStates ||= {};
    activeSession.mediaStates[peerId] ||= { micEnabled: false, cameraEnabled: false };
    if (kind === 'audio') {
      tile.micEnabled = enabled;
      activeSession.mediaStates[peerId].micEnabled = enabled;
    } else {
      tile.cameraEnabled = enabled;
      activeSession.mediaStates[peerId].cameraEnabled = enabled;
    }
    renderSessionMembers();
    const parts = [];
    if (tile.micEnabled !== null) parts.push(tile.micEnabled ? 'Mic on' : 'Muted');
    if (tile.cameraEnabled !== null) parts.push(tile.cameraEnabled ? 'Camera on' : 'Camera off');
    tile.state.textContent = parts.join(' · ') || 'Waiting for media';
  }

  function closePeerConnection(peerId) {
    const peer = peerConnections.get(peerId);
    if (peer) {
      peer.pc.ontrack = null;
      peer.pc.onicecandidate = null;
      peer.pc.close();
      peerConnections.delete(peerId);
    }
    const tile = remoteTiles.get(peerId);
    if (tile) {
      tile.video.srcObject = null;
      tile.element.remove();
      remoteTiles.delete(peerId);
      updateRemoteVideoGrid();
    }
  }

  function cleanupSessionMedia() {
    for (const peerId of [...peerConnections.keys()]) closePeerConnection(peerId);
    for (const track of localMediaStream?.getTracks() || []) track.stop();
    localVideo.srcObject = null;
    localMediaStream = null;
    localAudioTrack = null;
    localVideoTrack = null;
    currentMicOn = false;
    currentCameraOn = false;
    updateCallControl(document.getElementById('micControl'), false, 'Mic on');
    updateCallControl(document.getElementById('cameraControl'), false, 'Camera on');
    updateSelfMediaPreview();
    remoteVideoGrid.replaceChildren();
    remoteTiles.clear();
    updateRemoteVideoGrid();
  }

  async function sendPeerSignal(eventName, roomId, peerId, payload) {
    return realtime.emitAck(eventName, { roomId, toUserId: peerId, ...payload });
  }

  async function flushPendingIceCandidates(peer) {
    if (!peer.pc.remoteDescription || peer.ignoreOffer) return;
    for (const candidate of peer.pendingCandidates.splice(0)) {
      try { await peer.pc.addIceCandidate(candidate); }
      catch (error) { console.warn('[webrtc] Could not add queued ICE candidate', error); }
    }
  }

  function ensurePeerConnection(peerId) {
    if (!activeSession || !peerId || peerId === currentUser.id) return null;
    const existing = peerConnections.get(peerId);
    if (existing) {
      ensureRemoteTile(peerId);
      return existing;
    }
    if (typeof RTCPeerConnection !== 'function') {
      showToast('This browser does not support WebRTC audio/video. Try a current version of Chrome, Edge, or Firefox.');
      return null;
    }

    const roomId = activeSession.roomId;
    const pc = new RTCPeerConnection(rtcConfiguration);
    const peer = {
      pc,
      polite: String(currentUser.id).localeCompare(peerId) > 0,
      makingOffer: false,
      isSettingRemoteAnswerPending: false,
      ignoreOffer: false,
      pendingCandidates: []
    };
    peerConnections.set(peerId, peer);
    const tile = ensureRemoteTile(peerId);

    pc.onicecandidate = (event) => {
      if (!event.candidate || activeSession?.roomId !== roomId) return;
      void sendPeerSignal('webrtc:ice-candidate', roomId, peerId, { candidate: event.candidate.toJSON() })
        .catch((error) => console.warn('[webrtc] ICE signaling failed', error));
    };
    pc.ontrack = (event) => {
      const remoteTile = ensureRemoteTile(peerId);
      if (!remoteTile) return;
      if (event.streams?.[0]) remoteTile.video.srcObject = event.streams[0];
      else if (typeof MediaStream === 'function') {
        if (!remoteTile.remoteStream) remoteTile.remoteStream = new MediaStream();
        if (!remoteTile.remoteStream.getTracks().some((item) => item.id === event.track.id)) remoteTile.remoteStream.addTrack(event.track);
        remoteTile.video.srcObject = remoteTile.remoteStream;
      }
      if (event.track.kind === 'video') {
        remoteTile.element.classList.add('has-video');
        event.track.addEventListener('mute', () => remoteTile.element.classList.remove('has-video'));
        event.track.addEventListener('unmute', () => remoteTile.element.classList.add('has-video'));
      }
      remoteTile.video.play().catch(() => {});
    };
    pc.onconnectionstatechange = () => {
      if (!remoteTiles.has(peerId)) return;
      const currentTile = remoteTiles.get(peerId);
      if (pc.connectionState === 'connected') currentTile.state.textContent = 'Connected';
      else if (pc.connectionState === 'failed') currentTile.state.textContent = 'Connection failed';
      else if (pc.connectionState === 'connecting') currentTile.state.textContent = 'Connecting…';
    };
    pc.onnegotiationneeded = async () => {
      if (activeSession?.roomId !== roomId || pc.signalingState === 'closed') return;
      try {
        peer.makingOffer = true;
        await pc.setLocalDescription();
        if (pc.localDescription?.type !== 'offer') return;
        await sendPeerSignal('webrtc:offer', roomId, peerId, {
          description: { type: pc.localDescription.type, sdp: pc.localDescription.sdp }
        });
      } catch (error) {
        if (activeSession?.roomId === roomId) showToast(`Could not start media with ${remoteTiles.get(peerId)?.name.textContent || 'a room member'}: ${friendlyError(error)}`);
      } finally {
        peer.makingOffer = false;
      }
    };

    for (const track of localMediaStream?.getTracks() || []) {
      if (track.readyState === 'live') pc.addTrack(track, localMediaStream);
    }
    return peer;
  }

  async function handleWebRTCSignal(eventName, payload) {
    if (!activeSession || payload?.roomId !== activeSession.roomId) return;
    const peerId = String(payload.fromUserId || '');
    if (!peerId || peerId === currentUser.id) return;
    if (!activeSession.participants.some((item) => item.id === peerId)) {
      activeSession.participants.push({ id: peerId, name: 'Studyloop member' });
    }
    const peer = ensurePeerConnection(peerId);
    if (!peer) return;
    const pc = peer.pc;

    if (eventName === 'webrtc:ice-candidate') {
      if (!payload.candidate || peer.ignoreOffer) return;
      if (pc.remoteDescription) {
        try { await pc.addIceCandidate(payload.candidate); }
        catch (error) { console.warn('[webrtc] Could not add ICE candidate', error); }
      } else {
        peer.pendingCandidates.push(payload.candidate);
      }
      return;
    }

    const description = payload.description;
    if (!description || !['offer', 'answer'].includes(description.type)) return;
    const offerCollision = description.type === 'offer'
      && (peer.makingOffer || (pc.signalingState !== 'stable' && !peer.isSettingRemoteAnswerPending));
    peer.ignoreOffer = !peer.polite && offerCollision;
    if (peer.ignoreOffer) return;

    try {
      peer.isSettingRemoteAnswerPending = description.type === 'answer';
      await pc.setRemoteDescription(description);
      peer.isSettingRemoteAnswerPending = false;
      peer.ignoreOffer = false;
      await flushPendingIceCandidates(peer);
      if (description.type === 'offer') {
        await pc.setLocalDescription();
        await sendPeerSignal('webrtc:answer', activeSession.roomId, peerId, {
          description: { type: pc.localDescription.type, sdp: pc.localDescription.sdp }
        });
      }
    } catch (error) {
      peer.isSettingRemoteAnswerPending = false;
      if (!peer.ignoreOffer) showToast(`Could not establish media with ${remoteTiles.get(peerId)?.name.textContent || 'a room member'}: ${friendlyError(error)}`);
    }
  }

  function addRoomParticipant(member) {
    const participant = roomMember(member);
    if (!activeSession || !participant.id || participant.id === currentUser.id) return;
    const existing = activeSession.participants.find((item) => item.id === participant.id);
    if (existing) existing.name = participant.name;
    else activeSession.participants.push(participant);
    activeSession.mediaStates ||= {};
    activeSession.mediaStates[participant.id] ||= { micEnabled: false, cameraEnabled: false };
    renderSessionMembers();
    ensurePeerConnection(participant.id);
  }

  function updateCallControl(button, isOn, label) {
    button.setAttribute('aria-pressed', String(isOn));
    button.classList.toggle('is-off', !isOn);
    button.querySelector('.control-label').textContent = isOn ? label : `${label.replace(/ on$/i, '')} off`;
  }

  async function openStudySession(room, participants = [], mediaStates = {}) {
    if (!room?.id) {
      showToast('The server did not return a valid study room.');
      return;
    }
    if (activeSession?.roomId === room.id) {
      if (callModal.hidden) restoreCallSession();
      return;
    }
    if (activeSession) await leaveActiveSession();

    const members = participants.length ? participants.map(roomMember) : (room.members || []).map(roomMember);
    const partner = members.find((member) => member.id && member.id !== currentUser.id);
    const isGroup = room.type === 'group';
    const roomTitle = room.title || 'Study room';
    const subject = room.subject || 'Study session';
    const normalizedMedia = { ...(mediaStates || {}) };
    for (const member of members) {
      if (member.id && !normalizedMedia[member.id]) normalizedMedia[member.id] = { micEnabled: false, cameraEnabled: false };
    }
    activeSession = { roomId: room.id, room, participants: members, mediaStates: normalizedMedia };

    document.getElementById('callModalTitle').textContent = isGroup ? roomTitle : 'Your 1:1 study session';
    document.getElementById('callSubtitle').textContent = `${subject} · ${isGroup ? `${room.memberCount || members.length} person group room` : 'one-to-one study room'}`;
    document.getElementById('callRoomId').textContent = room.id;
    document.getElementById('copyCallRoomId').dataset.copyRoomId = room.id;
    document.getElementById('chatTitle').textContent = isGroup ? 'Room chat' : (partner?.name || 'Study partner');
    document.getElementById('chatSubtitle').textContent = isGroup ? `${roomTitle} · messages are shared with members` : `${subject} · private study room`;
    const peerName = isGroup ? `${room.memberCount || members.length} people studying` : (partner?.name || 'Your study partner');
    const peerInitials = initialsFor(isGroup ? roomTitle : peerName);
    const peerAvatar = avatarFor(isGroup ? room.id : (partner?.id || room.id));
    document.getElementById('stagePersonName').textContent = peerName;
    document.getElementById('stageStatus').textContent = `Connected to ${subject}. Turn on your mic or camera to start live media.`;
    const callAvatar = document.getElementById('callAvatar');
    callAvatar.className = `avatar stage-avatar ${peerAvatar}`;
    callAvatar.textContent = peerInitials;
    const chatAvatar = document.getElementById('chatPeerAvatar');
    chatAvatar.className = `avatar chat-peer-avatar ${peerAvatar}`;
    chatAvatar.textContent = peerInitials;
    document.getElementById('goalInput').value = room.goal || '';
    document.getElementById('goalStatus').textContent = room.goal ? 'Shared with active room members.' : 'Add a goal for everyone in this room.';
    document.getElementById('chatMessages').replaceChildren();
    document.getElementById('chatPreviewNote').textContent = 'Messages are saved to this study room.';
    document.getElementById('deleteRoomButton').hidden = !(isGroup && room.hostId === currentUser.id);
    document.getElementById('sessionDockTitle').textContent = roomTitle;

    currentCameraOn = false;
    currentMicOn = false;
    document.getElementById('selfAvatar').textContent = initialsFor(currentUser.displayName);
    updateCallControl(document.getElementById('cameraControl'), false, 'Camera on');
    updateCallControl(document.getElementById('micControl'), false, 'Mic on');
    updateSelfMediaPreview();
    renderSessionMembers();
    renderRoomJoinRequests();
    for (const member of members) {
      try { ensurePeerConnection(member.id); }
      catch (error) {
        console.error('[webrtc] Could not initialize a peer connection', error);
        showToast(`The room opened, but live media could not initialize: ${error.message || 'WebRTC is unavailable in this browser.'}`);
      }
    }
    openModal(callModal);
    void Promise.all([
      sendMediaToggle('mic_toggle', false),
      sendMediaToggle('camera_toggle', false)
    ]).catch((error) => console.warn('[media] Could not sync initial off state', error));
    await loadRoomMessages(room.id);
  }

  async function openRoomById(roomId) {
    try {
      const result = await api.request(`/rooms/${encodeURIComponent(roomId)}`);
      if (!result?.room?.id) throw new Error('The server returned no room details. Check the API logs and try again.');
      await openStudySession(result.room, [], result.mediaStates || {});
    } catch (error) {
      reportError(error);
    }
  }

  async function joinRoom(roomId, clickedButton = null) {
    const button = clickedButton || [...roomGrid.querySelectorAll('[data-room-id]')].find((item) => item.dataset.roomId === roomId);
    if (button) button.disabled = true;
    try {
      const result = await realtime.emitAck('room:join', { roomId });
      const joinedRoomId = result?.room?.id;
      if (!joinedRoomId) throw new Error('The server acknowledged the join without returning room details. Check the API logs.');
      await loadRooms();
      await openRoomById(joinedRoomId);
    } catch (error) {
      if (button) button.disabled = false;
      reportError(error);
    }
  }

  function clearMatchPolling() {
    window.clearInterval(matchPollTimer);
    matchPollTimer = null;
  }

  function startMatchPolling() {
    clearMatchPolling();
    matchPollTimer = window.setInterval(async () => {
      try {
        const status = await api.request('/matchmaking');
        if (status.status === 'idle') {
          clearMatchPolling();
          setMatchStatus('Your search ended. Start a new match when you are ready.');
          return;
        }
        const description = status.anyField ? 'a study partner from any field' : `a study partner studying ${status.subject}`;
        setMatchStatus(`Searching for ${description} · queue position ${status.queuePosition || '…'}`, true);
      } catch (error) {
        clearMatchPolling();
        reportError(error);
        setMatchStatus('Could not check your matchmaking status.');
      }
    }, 5000);
  }

  async function findStudyBuddy(subjectOverride = '', anyFieldOverride = false) {
    if (!realtime.ready) {
      showToast('Realtime is not connected yet. Wait a moment and try again.');
      return;
    }
    const anyField = anyFieldOverride || (!subjectOverride && subjectFilter.value === 'all');
    const subject = anyField ? 'Any field' : (subjectOverride || subjectFilter.value);
    if (!subject) {
      showToast('Choose a study field or select All fields of study.');
      return;
    }
    const searchDescription = anyField ? 'a study partner from any field' : `someone studying ${subject}`;
    setMatchStatus(`Looking for ${searchDescription}…`, true);
    try {
      const body = anyField
        ? { anyField: true, availability: currentUser.availability || 'flexible' }
        : { subject, availability: currentUser.availability || 'flexible' };
      const result = await api.request('/matchmaking', { method: 'POST', body });
      if (result.status === 'matched') {
        clearMatchPolling();
        setMatchStatus('Match found. Opening your study room…');
        await openStudySession(result.room, result.participants || []);
      } else if (result.status === 'queued') {
        const description = anyField ? 'a study partner from any field' : `a study partner studying ${subject}`;
        setMatchStatus(`Searching for ${description} · queue position ${result.queuePosition || '…'}`, true);
        startMatchPolling();
      } else if (result.status === 'retry') {
        clearMatchPolling();
        setMatchStatus(result.message || 'That match is no longer available. Try again.');
      }
    } catch (error) {
      clearMatchPolling();
      setMatchStatus(friendlyError(error));
      reportError(error);
    }
  }

  async function cancelMatch() {
    cancelMatchButton.disabled = true;
    try {
      await api.request('/matchmaking', { method: 'DELETE' });
      clearMatchPolling();
      setMatchStatus('Matchmaking search cancelled.');
    } catch (error) {
      reportError(error);
    } finally {
      cancelMatchButton.disabled = false;
    }
  }

  async function createRoom(event) {
    event.preventDefault();
    const submit = roomCreateForm.querySelector('[type="submit"]');
    const values = roomCreateForm.elements;
    setRoomFeedback('Creating your room…');
    submit.disabled = true;
    try {
      const result = await api.request('/rooms', {
        method: 'POST',
        body: {
          title: values.title.value.trim(),
          subject: values.subject.value,
          capacity: Number(values.capacity.value)
        }
      });
      setRoomFeedback('Room created. Opening it now.');
      roomCreateForm.reset();
      values.capacity.value = '4';
      await loadRooms();
      await openRoomById(result.room.id);
    } catch (error) {
      setRoomFeedback(friendlyError(error), true);
    } finally {
      submit.disabled = false;
    }
  }

  async function leaveActiveSession() {
    if (!activeSession) {
      closeModal();
      return;
    }
    const leaving = activeSession;
    const roomId = leaving.roomId;
    cleanupSessionMedia();
    try {
      const result = await api.request(`/rooms/${encodeURIComponent(roomId)}/leave`, { method: 'POST', body: {} });
      const duration = Math.max(0, Number(result.durationSeconds) || 0);
      showToast(`You left the room · ${Math.floor(duration / 60)}m ${duration % 60}s studied.`);
    } catch (error) {
      reportError(error);
    } finally {
      activeSession = null;
      sessionDock.hidden = true;
      if (document.fullscreenElement === callModal) void document.exitFullscreen?.().catch(() => {});
      if (activeModal === callModal) closeModal();
      else callModal.hidden = true;
      void loadRooms();
    }
  }

  async function deleteActiveRoom() {
    const room = activeSession?.room;
    if (!room || room.hostId !== currentUser.id) return;
    if (!window.confirm(`Delete “${room.title || 'this room'}” for everyone? This cannot be undone.`)) return;
    const roomId = activeSession.roomId;
    const button = document.getElementById('deleteRoomButton');
    button.disabled = true;
    button.textContent = 'Deleting…';
    try {
      await api.request(`/rooms/${encodeURIComponent(roomId)}`, { method: 'DELETE' });
      if (activeSession?.roomId === roomId) {
        cleanupSessionMedia();
        activeSession = null;
      }
      sessionDock.hidden = true;
      if (document.fullscreenElement === callModal) await document.exitFullscreen().catch(() => {});
      if (activeModal === callModal) closeModal();
      else callModal.hidden = true;
      showToast('Room deleted. Members have been notified.');
      await Promise.all([loadRooms(), loadStudyRequests()]);
    } catch (error) {
      reportError(error);
      button.disabled = false;
      button.textContent = 'Delete room';
    }
  }

  function handleSocketEvents() {
    socket.on('message', (message) => {
      if (activeSession?.roomId === message.roomId) appendChatMessage(message);
    });
    socket.on('match:found', async ({ room, participants }) => {
      clearMatchPolling();
      setMatchStatus('Match found. Opening your study room…');
      await openStudySession(room, participants || []);
    });
    socket.on('match:failed', ({ message }) => {
      clearMatchPolling();
      setMatchStatus(message || 'The match could not be opened. Try again.');
    });
    socket.on('study-request:received', (request) => {
      const sender = request.fromUser?.displayName || 'A Studyloop student';
      showToast(request.kind === 'room' ? `${sender} requested to join your room.` : `${sender} sent you a 1:1 study request.`);
      void loadStudyRequests();
    });
    socket.on('study-request:updated', (request) => {
      void loadStudyRequests();
      if (searchedRoomId && request.kind === 'room') void lookupRoomById(searchedRoomId, false);
      if (request.fromUser?.id === currentUser.id && request.status === 'accepted' && request.resultRoom?.id) {
        showToast(request.kind === 'room' ? 'Your room request was approved.' : 'Your study request was accepted.');
        void openRoomById(request.resultRoom.id);
      } else if (request.fromUser?.id === currentUser.id && request.status === 'declined') {
        showToast('Your study request was declined.');
      } else if (request.toUser?.id === currentUser.id && request.status === 'cancelled') {
        showToast('A study request was cancelled.');
      }
    });
    socket.on('user_joined', ({ roomId, user, memberCount }) => {
      if (activeSession?.roomId !== roomId) return;
      activeSession.room.memberCount = memberCount;
      if (user?.id && user.id !== currentUser.id) addRoomParticipant(user);
      document.getElementById('stageStatus').textContent = `${user?.displayName || 'A member'} joined · ${memberCount} in the room`;
      void loadRooms();
    });
    socket.on('user_left', ({ roomId, memberCount, userId, roomClosed }) => {
      if (activeSession?.roomId !== roomId) return;
      activeSession.room.memberCount = memberCount;
      if (userId !== currentUser.id) {
        closePeerConnection(String(userId));
        activeSession.participants = activeSession.participants.filter((member) => member.id !== String(userId));
        delete activeSession.mediaStates?.[String(userId)];
        renderSessionMembers();
        showToast('A study partner left the room.');
      }
      if (roomClosed) {
        cleanupSessionMedia();
        activeSession = null;
        sessionDock.hidden = true;
        closeModal();
      }
      void loadRooms();
    });
    socket.on('room:closed', ({ roomId }) => {
      if (activeSession?.roomId === roomId) {
        cleanupSessionMedia();
        activeSession = null;
        sessionDock.hidden = true;
        closeModal();
        showToast('This study room has been deleted by its owner.');
      }
      void loadRooms();
    });
    socket.on('room:goal', ({ roomId, goal }) => {
      if (activeSession?.roomId !== roomId) return;
      activeSession.room.goal = goal || '';
      document.getElementById('goalInput').value = goal || '';
      document.getElementById('goalStatus').textContent = goal ? 'A room member updated the shared goal.' : 'The shared goal was cleared.';
    });
    socket.on('mic_toggle', ({ roomId, userId, enabled }) => {
      if (activeSession?.roomId === roomId && userId !== currentUser.id) updateRemoteMediaState(String(userId), 'audio', enabled);
    });
    socket.on('camera_toggle', ({ roomId, userId, enabled }) => {
      if (activeSession?.roomId === roomId && userId !== currentUser.id) updateRemoteMediaState(String(userId), 'video', enabled);
    });
    socket.on('webrtc:offer', (payload) => { void handleWebRTCSignal('webrtc:offer', payload); });
    socket.on('webrtc:answer', (payload) => { void handleWebRTCSignal('webrtc:answer', payload); });
    socket.on('webrtc:ice-candidate', (payload) => { void handleWebRTCSignal('webrtc:ice-candidate', payload); });
    socket.on('presence:changed', () => {
      window.clearTimeout(window._studyloopPresenceRefresh);
      window._studyloopPresenceRefresh = window.setTimeout(() => {
        void loadStudents();
        void loadRooms();
      }, 250);
    });
  }

  async function sendMediaToggle(eventName, enabled) {
    if (!activeSession) throw new Error('Join a study room before changing your session media state.');
    return realtime.emitAck(eventName, { roomId: activeSession.roomId, enabled });
  }

  async function sendMessage(body) {
    if (!activeSession) throw new Error('Join a room before sending a message.');
    const clientMessageId = `web-${window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
    const message = await realtime.emitAck('message', { roomId: activeSession.roomId, body, clientMessageId });
    appendChatMessage(message, true);
  }

  async function toggleLocalMedia(kind, button) {
    const isAudio = kind === 'audio';
    const next = isAudio ? !currentMicOn : !currentCameraOn;
    const eventName = isAudio ? 'mic_toggle' : 'camera_toggle';
    const label = isAudio ? 'Mic on' : 'Camera on';
    const humanKind = isAudio ? 'microphone' : 'camera';
    button.disabled = true;
    try {
      if (next) await ensureLocalTrack(kind);
      const track = isAudio ? localAudioTrack : localVideoTrack;
      if (track?.readyState === 'live') track.enabled = next;
      if (isAudio) currentMicOn = next;
      else currentCameraOn = next;
      updateCallControl(button, next, label);
      renderSessionMembers();
      updateSelfMediaPreview();
      try { await sendMediaToggle(eventName, next); }
      catch (error) { reportError(error); }
    } catch (error) {
      showToast(mediaAccessMessage(error, humanKind));
    } finally {
      button.disabled = false;
    }
  }

  function wireSessionControls() {
    const micControl = document.getElementById('micControl');
    const cameraControl = document.getElementById('cameraControl');
    micControl.addEventListener('click', () => void toggleLocalMedia('audio', micControl));
    cameraControl.addEventListener('click', () => void toggleLocalMedia('video', cameraControl));
    document.getElementById('endSession').addEventListener('click', () => void leaveActiveSession());

    const goalForm = document.getElementById('goalForm');
    const goalInput = document.getElementById('goalInput');
    const goalSaveButton = document.getElementById('goalSaveButton');
    const goalStatus = document.getElementById('goalStatus');
    goalForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!activeSession) {
        goalStatus.textContent = 'Join a study room before setting its goal.';
        return;
      }
      goalSaveButton.disabled = true;
      goalStatus.textContent = 'Saving shared goal…';
      try {
        const result = await realtime.emitAck('room:goal', {
          roomId: activeSession.roomId,
          goal: goalInput.value.trim()
        });
        activeSession.room.goal = result.goal || '';
        goalStatus.textContent = result.goal ? 'Shared with active room members.' : 'Shared goal cleared.';
      } catch (error) {
        goalStatus.textContent = 'Could not save the goal.';
        reportError(error);
      } finally {
        goalSaveButton.disabled = false;
      }
    });

    const chatForm = document.getElementById('chatForm');
    const chatInput = document.getElementById('chatInput');
    const chatCharCount = document.getElementById('chatCharCount');
    chatInput.addEventListener('input', () => { chatCharCount.textContent = `${chatInput.value.length} / 300`; });
    chatForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const body = chatInput.value.trim();
      if (!body) return;
      const submit = chatForm.querySelector('[type="submit"]');
      submit.disabled = true;
      try {
        await sendMessage(body);
        chatInput.value = '';
        chatCharCount.textContent = '0 / 300';
      } catch (error) {
        reportError(error);
      } finally {
        submit.disabled = false;
        chatInput.focus();
      }
    });
  }

  function setProfileFeedback(message, success = false) {
    const feedback = document.getElementById('profileFeedback');
    feedback.textContent = message;
    feedback.className = `profile-feedback${success ? ' is-success' : ''}`;
    feedback.hidden = !message;
  }

  function openProfileEditor() {
    const fields = document.getElementById('profileForm').elements;
    fields.displayName.value = currentUser.displayName || '';
    fields.subjects.value = (currentUser.subjects || []).join(', ');
    fields.availability.value = currentUser.availability || 'flexible';
    fields.bio.value = currentUser.bio || '';
    fields.timezone.value = currentUser.timezone || '';
    setProfileFeedback('');
    openModal(profileModal);
  }

  async function deleteProfile() {
    const button = document.getElementById('deleteProfileButton');
    if (!window.confirm('Permanently delete your Studyloop account? This cannot be undone.')) return;
    if (window.prompt('Type DELETE to confirm account deletion.') !== 'DELETE') return;

    button.disabled = true;
    button.textContent = 'Deleting…';
    try {
      await api.request('/users/me', { method: 'DELETE' });
      clearMatchPolling();
      realtime.disconnect();
      api.clearAccessToken();
      window.location.replace('login.html?accountDeleted=1');
    } catch (error) {
      setProfileFeedback(friendlyError(error));
      button.disabled = false;
      button.textContent = 'Delete profile';
    }
  }

  async function saveProfile(event) {
    event.preventDefault();
    const profileForm = document.getElementById('profileForm');
    const fields = profileForm.elements;
    const submitButton = document.getElementById('profileSaveButton');
    const normalizedSubjects = [];
    const seenSubjects = new Set();
    for (const item of fields.subjects.value.split(/[\n,]+/)) {
      const label = item.trim();
      const key = label.toLocaleLowerCase();
      if (label && !seenSubjects.has(key)) {
        normalizedSubjects.push(label);
        seenSubjects.add(key);
      }
    }
    if (normalizedSubjects.length < 1 || normalizedSubjects.length > 10 || normalizedSubjects.some((subject) => subject.length < 2 || subject.length > 80)) {
      setProfileFeedback('Enter between 1 and 10 study fields, each 2–80 characters long.');
      return;
    }

    const update = {};
    const displayName = fields.displayName.value.trim();
    const bio = fields.bio.value.trim();
    const timezone = fields.timezone.value.trim();
    if (displayName !== currentUser.displayName) update.displayName = displayName;
    if (normalizedSubjects.length !== currentUser.subjects.length || normalizedSubjects.some((subject, index) => subject !== currentUser.subjects[index])) update.subjects = normalizedSubjects;
    if (fields.availability.value !== currentUser.availability) update.availability = fields.availability.value;
    if (bio !== (currentUser.bio || '')) update.bio = bio;
    if (timezone !== (currentUser.timezone || '')) update.timezone = timezone;
    if (!Object.keys(update).length) {
      setProfileFeedback('Your profile is already up to date.', true);
      return;
    }

    submitButton.disabled = true;
    setProfileFeedback('Saving your profile…', true);
    try {
      const result = await api.request('/users/me', { method: 'PATCH', body: update });
      const previousDisplayName = currentUser.displayName;
      currentUser = result.user;
      auth.updateHeader(currentUser);
      syncProfileSubjects();
      if (update.subjects || update.availability) {
        clearMatchPolling();
        setMatchStatus('Your profile changed. Start a new search when you are ready.');
      }
      if (previousDisplayName !== currentUser.displayName && realtime.ready) {
        realtime.disconnect();
        try {
          socket = await realtime.connect();
          handleSocketEvents();
        } catch (error) {
          showToast(`Profile saved, but realtime could not reconnect: ${friendlyError(error)}`);
        }
      }
      await loadStudents();
      setProfileFeedback('Profile saved to your account.', true);
    } catch (error) {
      setProfileFeedback(friendlyError(error));
    } finally {
      submitButton.disabled = false;
    }
  }

  function wirePageControls() {
    document.getElementById('authGreeting').addEventListener('click', openProfileEditor);
    document.getElementById('profileForm').addEventListener('submit', (event) => void saveProfile(event));
    document.getElementById('deleteProfileButton').addEventListener('click', () => void deleteProfile());
    studentGrid.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-action="study-request"]');
      if (button && !button.disabled) void sendDirectStudyRequest(button);
    });
    document.getElementById('startMatchButton').addEventListener('click', () => void findStudyBuddy());
    document.getElementById('cancelMatchButton').addEventListener('click', () => void cancelMatch());
    searchForm.addEventListener('submit', (event) => {
      event.preventDefault();
      void loadStudents();
      resultsLabel.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    searchInput.addEventListener('input', () => {
      window.clearTimeout(searchDebounce);
      searchDebounce = window.setTimeout(() => void loadStudents(), 280);
    });
    subjectFilter.addEventListener('change', () => void loadStudents());
    availabilityFilter.addEventListener('change', () => void loadStudents());
    document.getElementById('clearFilters').addEventListener('click', () => {
      searchInput.value = '';
      subjectFilter.value = 'all';
      availabilityFilter.value = 'any';
      void loadStudents();
      searchInput.focus();
    });
    document.getElementById('resetSearch').addEventListener('click', () => {
      searchInput.value = '';
      subjectFilter.value = 'all';
      availabilityFilter.value = 'any';
      void loadStudents();
    });
    const handleRoomCardClick = (event) => {
      const copyButton = event.target.closest('[data-copy-room-id]');
      if (copyButton) {
        void copyRoomId(copyButton);
        return;
      }
      const requestButton = event.target.closest('button[data-request-action]');
      if (requestButton && !requestButton.disabled) {
        void respondToStudyRequest(requestButton.dataset.requestId, requestButton.dataset.requestAction, requestButton);
        return;
      }
      const button = event.target.closest('button[data-room-action]');
      if (!button || button.disabled) return;
      if (button.dataset.roomAction === 'open-room') void joinRoom(button.dataset.roomId, button);
      else if (button.dataset.roomAction === 'request-room') void sendRoomJoinRequest(button.dataset.roomId, button);
    };
    roomGrid.addEventListener('click', handleRoomCardClick);
    roomSearchResult.addEventListener('click', handleRoomCardClick);
    callModal.addEventListener('click', handleRoomCardClick);
    callModal.addEventListener('click', (event) => {
      if (event.target.closest('[data-minimize-session]')) minimizeCallSession();
    });
    document.getElementById('minimizeSessionButton').addEventListener('click', minimizeCallSession);
    document.getElementById('sessionDockOpen').addEventListener('click', restoreCallSession);
    document.getElementById('sessionDockLeave').addEventListener('click', () => void leaveActiveSession());
    document.getElementById('deleteRoomButton').addEventListener('click', () => void deleteActiveRoom());
    document.getElementById('fullscreenSessionButton').addEventListener('click', async () => {
      try {
        if (document.fullscreenElement === callModal) await document.exitFullscreen();
        else if (callModal.requestFullscreen) await callModal.requestFullscreen();
        else showToast('Full-screen mode is not available in this browser.');
      } catch { showToast('The browser did not allow full-screen mode.'); }
    });
    roomLookupForm.addEventListener('submit', (event) => {
      event.preventDefault();
      void lookupRoomById(roomLookupForm.elements.roomId.value);
    });
    roomLookupForm.elements.roomId.addEventListener('input', () => {
      if (!roomLookupForm.elements.roomId.value.trim()) {
        searchedRoomId = '';
        roomSearchResult.hidden = true;
        setRoomLookupFeedback('');
      }
    });
    const handleRequestAction = (event) => {
      const openButton = event.target.closest('[data-open-room-id]');
      if (openButton) {
        void openRoomById(openButton.dataset.openRoomId);
        return;
      }
      const button = event.target.closest('[data-request-action]');
      if (button && !button.disabled) {
        void respondToStudyRequest(button.dataset.requestId, button.dataset.requestAction, button);
      }
    };
    incomingRequestsList.addEventListener('click', handleRequestAction);
    outgoingRequestsList.addEventListener('click', handleRequestAction);
    roomCreateForm.addEventListener('submit', (event) => void createRoom(event));

    document.querySelectorAll('[data-toast]').forEach((button) => {
      button.addEventListener('click', () => showToast(button.dataset.toast));
    });
    document.querySelectorAll('[data-close-modal]').forEach((button) => {
      button.addEventListener('click', () => {
        if (button.closest('#callModal')) void leaveActiveSession();
        else closeModal();
      });
    });
    [callModal, boardModal, profileModal].forEach((modal) => {
      modal.addEventListener('mousedown', (event) => {
        if (event.target !== modal) return;
        if (modal === callModal) minimizeCallSession();
        else closeModal();
      });
    });
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || !activeModal) return;
      if (activeModal === callModal) minimizeCallSession();
      else closeModal();
    });

    const menuToggle = document.getElementById('menuToggle');
    const mainNav = document.getElementById('mainNav');
    menuToggle.addEventListener('click', () => {
      const isOpen = mainNav.classList.toggle('is-open');
      menuToggle.setAttribute('aria-expanded', String(isOpen));
      menuToggle.setAttribute('aria-label', isOpen ? 'Close navigation menu' : 'Open navigation menu');
    });
    mainNav.querySelectorAll('a').forEach((link) => link.addEventListener('click', () => {
      mainNav.classList.remove('is-open');
      menuToggle.setAttribute('aria-expanded', 'false');
      menuToggle.setAttribute('aria-label', 'Open navigation menu');
    }));
  }

  async function initializeApp() {
    currentUser = await auth.ready;
    if (!currentUser) return;
    syncProfileSubjects();
    wirePageControls();
    wireSessionControls();
    try {
      socket = await realtime.connect();
      handleSocketEvents();
    } catch (error) {
      showToast(`Realtime unavailable: ${friendlyError(error)}`);
    }
    await Promise.all([loadStudents(), loadRooms(), loadStudyRequests()]);
    window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void loadStudents();
        void loadRooms();
        void loadStudyRequests();
      }
    }, 30000);
  }

  void initializeApp().catch((error) => {
    reportError(error);
  });
})();
