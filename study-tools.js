(() => {
  'use strict';
  const showToast = (message) => window.StudyloopApp?.showToast(message);
  // Configurable focus timer shared by the card and its draggable floating widget.
  const timerMinutesInput = document.getElementById('timerMinutes');
  const timerDisplay = document.getElementById('timerDisplay');
  const timerState = document.getElementById('timerState');
  const timerToggle = document.getElementById('timerToggle');
  const timerRing = document.getElementById('timerRing');
  const floatingTimer = document.getElementById('floatingTimer');
  const floatingTimerDisplay = document.getElementById('floatingTimerDisplay');
  const floatingTimerState = document.getElementById('floatingTimerState');
  const floatingTimerToggle = document.getElementById('floatingTimerToggle');
  let focusDuration = Math.min(240, Math.max(1, Number(localStorage.getItem('studyloop:focus-minutes')) || 25)) * 60;
  let secondsRemaining = focusDuration;
  let timerInterval = null;
  let timerDeadline = null;

  function timerText(seconds) {
    return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
  }

  function renderTimer() {
    const text = timerText(secondsRemaining);
    timerDisplay.textContent = text;
    floatingTimerDisplay.textContent = text;
    const progress = ((focusDuration - secondsRemaining) / focusDuration) * 100;
    timerRing.style.setProperty('--progress', `${Math.min(100, Math.max(0, progress)).toFixed(2)}%`);
    const running = Boolean(timerInterval);
    timerToggle.innerHTML = running ? 'Pause focus <span aria-hidden="true">Ⅱ</span>' : (secondsRemaining < focusDuration ? 'Resume focus <span aria-hidden="true">→</span>' : 'Start focus <span aria-hidden="true">→</span>');
    floatingTimerToggle.textContent = running ? 'Pause' : (secondsRemaining < focusDuration ? 'Resume' : 'Start');
    floatingTimerState.textContent = running ? 'Focus sprint running' : (secondsRemaining === 0 ? 'Sprint complete' : secondsRemaining < focusDuration ? 'Paused' : 'Ready');
  }

  function pauseTimer() {
    if (!timerInterval) return;
    secondsRemaining = Math.max(0, Math.ceil((timerDeadline - Date.now()) / 1000));
    window.clearInterval(timerInterval);
    timerInterval = null;
    timerDeadline = null;
    timerState.textContent = 'PAUSED · TAKE YOUR TIME';
    renderTimer();
  }

  function startTimer() {
    if (timerInterval) return pauseTimer();
    if (secondsRemaining <= 0) secondsRemaining = focusDuration;
    timerDeadline = Date.now() + secondsRemaining * 1000;
    timerState.textContent = "FOCUSING · YOU'VE GOT THIS";
    timerInterval = window.setInterval(() => {
      secondsRemaining = Math.max(0, Math.ceil((timerDeadline - Date.now()) / 1000));
      renderTimer();
      if (secondsRemaining <= 0) {
        window.clearInterval(timerInterval);
        timerInterval = null;
        timerDeadline = null;
        timerState.textContent = 'SPRINT COMPLETE · NICE WORK';
        renderTimer();
        showToast('Focus sprint complete. Nice work!');
      }
    }, 250);
    renderTimer();
  }

  function resetTimer() {
    window.clearInterval(timerInterval);
    timerInterval = null;
    timerDeadline = null;
    secondsRemaining = focusDuration;
    timerState.textContent = 'READY WHEN YOU ARE';
    renderTimer();
  }

  timerToggle.addEventListener('click', startTimer);
  floatingTimerToggle.addEventListener('click', startTimer);
  document.getElementById('timerReset').addEventListener('click', resetTimer);
  document.getElementById('floatingTimerReset').addEventListener('click', resetTimer);
  document.getElementById('timerSetButton').addEventListener('click', () => {
    const minutes = Number.parseInt(timerMinutesInput.value, 10);
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 240) {
      showToast('Choose a timer duration from 1 to 240 minutes.');
      timerMinutesInput.focus();
      return;
    }
    focusDuration = minutes * 60;
    localStorage.setItem('studyloop:focus-minutes', String(minutes));
    resetTimer();
    timerState.textContent = `${minutes} MINUTE SPRINT · READY`;
  });
  timerMinutesInput.value = String(Math.round(focusDuration / 60));
  document.getElementById('timerFloatButton').addEventListener('click', () => {
    floatingTimer.hidden = false;
    restoreFloatingTimerPosition();
  });
  document.getElementById('closeFloatingTimer').addEventListener('click', () => { floatingTimer.hidden = true; });

  function restoreFloatingTimerPosition() {
    try {
      const saved = JSON.parse(localStorage.getItem('studyloop:timer-position') || 'null');
      if (saved && Number.isFinite(saved.left) && Number.isFinite(saved.top)) {
        floatingTimer.style.left = `${saved.left}px`;
        floatingTimer.style.top = `${saved.top}px`;
        floatingTimer.style.right = 'auto';
        floatingTimer.style.bottom = 'auto';
      }
    } catch { /* ignore an invalid saved position */ }
  }

  const floatingTimerDrag = document.getElementById('floatingTimerDrag');
  let timerDrag = null;
  floatingTimerDrag.addEventListener('pointerdown', (event) => {
    if (event.target.closest('button')) return;
    const bounds = floatingTimer.getBoundingClientRect();
    timerDrag = { offsetX: event.clientX - bounds.left, offsetY: event.clientY - bounds.top };
    floatingTimerDrag.setPointerCapture(event.pointerId);
  });
  floatingTimerDrag.addEventListener('pointermove', (event) => {
    if (!timerDrag) return;
    const maxLeft = Math.max(0, window.innerWidth - floatingTimer.offsetWidth);
    const maxTop = Math.max(0, window.innerHeight - floatingTimer.offsetHeight);
    const left = Math.min(maxLeft, Math.max(0, event.clientX - timerDrag.offsetX));
    const top = Math.min(maxTop, Math.max(0, event.clientY - timerDrag.offsetY));
    floatingTimer.style.left = `${left}px`;
    floatingTimer.style.top = `${top}px`;
    floatingTimer.style.right = 'auto';
    floatingTimer.style.bottom = 'auto';
    localStorage.setItem('studyloop:timer-position', JSON.stringify({ left, top }));
  });
  const stopTimerDrag = () => { timerDrag = null; };
  floatingTimerDrag.addEventListener('pointerup', stopTimerDrag);
  floatingTimerDrag.addEventListener('pointercancel', stopTimerDrag);

  // Notes are account-scoped and saved through the central API client.
  const api = window.StudyloopAPI;
  const auth = window.StudyloopAuth;
  const notesEditor = document.getElementById('notesEditor');
  const notesStatus = document.getElementById('notesStatus');
  const notesCount = document.getElementById('notesCount');
  let notesSaveTimeout;
  let notesRevision = 0;
  let notesSaveQueue = Promise.resolve();

  function updateNotesCount() {
    notesCount.textContent = `${notesEditor.value.length} / 500`;
  }

  async function loadNote() {
    try {
      await auth.ready;
      const result = await api.request('/study-tools/notes/me');
      notesEditor.value = result.note?.body || '';
      notesStatus.textContent = 'Saved to account';
    } catch (error) {
      notesStatus.textContent = 'Sync unavailable';
      showToast(`Could not load your note: ${error.message}`);
    } finally {
      notesEditor.disabled = false;
      updateNotesCount();
    }
  }

  notesEditor.addEventListener('input', () => {
    updateNotesCount();
    notesStatus.textContent = 'Saving…';
    const revision = ++notesRevision;
    window.clearTimeout(notesSaveTimeout);
    notesSaveTimeout = window.setTimeout(() => {
      const body = notesEditor.value;
      notesSaveQueue = notesSaveQueue.catch(() => {}).then(async () => {
        await auth.ready;
        await api.request('/study-tools/notes/me', { method: 'PUT', body: { body } });
        if (revision === notesRevision) notesStatus.textContent = 'Saved to account';
      }).catch((error) => {
        if (revision === notesRevision) {
          notesStatus.textContent = 'Save failed';
          showToast(`Could not save your note: ${error.message}`);
        }
      });
    }, 500);
  });
  void loadNote();

  // Account-scoped flashcards are grouped by a student-defined topic.
  const flashcards = [];
  let flashcardIndex = 0;
  let isCardFlipped = false;
  let selectedFlashcardTopic = 'all';
  const flashcard = document.getElementById('flashcard');
  const flashcardLabel = document.getElementById('flashcardLabel');
  const flashcardPrompt = document.getElementById('flashcardPrompt');
  const flashcardHint = document.getElementById('flashcardHint');
  const flashcardCounter = document.getElementById('cardCounter');
  const flashcardStatus = document.getElementById('flashcardStatus');
  const topicFilter = document.getElementById('flashcardTopicFilter');
  const previousCardButton = document.getElementById('previousCard');
  const nextCardButton = document.getElementById('nextCard');
  const deleteFlashcardButton = document.getElementById('deleteFlashcard');
  const flashcardForm = document.getElementById('flashcardForm');

  function visibleFlashcards() {
    return selectedFlashcardTopic === 'all'
      ? flashcards
      : flashcards.filter((card) => (card.topic || 'General') === selectedFlashcardTopic);
  }

  function updateFlashcardTopics() {
    const current = selectedFlashcardTopic;
    const topics = [...new Set(flashcards.map((card) => (card.topic || 'General').trim()).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b));
    topicFilter.replaceChildren(new Option('All topics', 'all'));
    for (const topic of topics) topicFilter.add(new Option(topic, topic));
    selectedFlashcardTopic = current === 'all' || topics.includes(current) ? current : 'all';
    topicFilter.value = selectedFlashcardTopic;
  }

  function renderFlashcard() {
    const cards = visibleFlashcards();
    const hasCards = cards.length > 0;
    flashcard.disabled = !hasCards;
    previousCardButton.disabled = cards.length < 2;
    nextCardButton.disabled = cards.length < 2;
    deleteFlashcardButton.disabled = !hasCards;
    flashcard.classList.toggle('is-flipped', hasCards && isCardFlipped);
    if (!hasCards) {
      flashcardLabel.textContent = selectedFlashcardTopic === 'all' ? 'YOUR DECK' : selectedFlashcardTopic.toUpperCase();
      flashcardPrompt.textContent = flashcards.length ? 'No cards in this topic yet.' : 'Add your first question below.';
      flashcardHint.textContent = 'Choose a topic or add a card to get started';
      flashcardCounter.textContent = flashcards.length ? '0 in topic' : '0 cards';
      flashcard.setAttribute('aria-label', 'No flashcards in this topic');
      return;
    }
    flashcardIndex = ((flashcardIndex % cards.length) + cards.length) % cards.length;
    const card = cards[flashcardIndex];
    flashcardLabel.textContent = isCardFlipped ? `ANSWER · ${card.topic || 'General'}` : `QUESTION · ${card.topic || 'General'}`;
    flashcardPrompt.textContent = isCardFlipped ? card.back : card.front;
    flashcardHint.textContent = isCardFlipped ? 'Nice recall · tap to see the question' : 'Tap to reveal the answer';
    flashcardCounter.textContent = `${String(flashcardIndex + 1).padStart(2, '0')} / ${String(cards.length).padStart(2, '0')}`;
    flashcard.setAttribute('aria-label', isCardFlipped ? 'Show flashcard question' : 'Reveal flashcard answer');
  }

  async function loadFlashcards() {
    try {
      await auth.ready;
      const cards = await api.request('/study-tools/flashcards');
      flashcards.splice(0, flashcards.length, ...cards.map((card) => ({ ...card, topic: card.topic || 'General' })));
      updateFlashcardTopics();
      flashcardStatus.textContent = cards.length ? 'Saved to your account' : 'Add a card to start your deck';
      renderFlashcard();
    } catch (error) {
      flashcardStatus.textContent = 'Could not load cards';
      flashcardPrompt.textContent = 'Your saved cards could not be loaded.';
      flashcardHint.textContent = 'Check your connection and try again';
      flashcardCounter.textContent = 'Unavailable';
      showToast(`Could not load flashcards: ${error.message}`);
    }
  }

  topicFilter.addEventListener('change', () => {
    selectedFlashcardTopic = topicFilter.value;
    flashcardIndex = 0;
    isCardFlipped = false;
    renderFlashcard();
  });
  flashcard.addEventListener('click', () => {
    if (!visibleFlashcards().length) return;
    isCardFlipped = !isCardFlipped;
    renderFlashcard();
  });
  previousCardButton.addEventListener('click', () => {
    const cards = visibleFlashcards();
    if (cards.length < 2) return;
    flashcardIndex = (flashcardIndex - 1 + cards.length) % cards.length;
    isCardFlipped = false;
    renderFlashcard();
  });
  nextCardButton.addEventListener('click', () => {
    const cards = visibleFlashcards();
    if (cards.length < 2) return;
    flashcardIndex = (flashcardIndex + 1) % cards.length;
    isCardFlipped = false;
    renderFlashcard();
  });
  flashcardForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(flashcardForm);
    const submitButton = flashcardForm.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    flashcardStatus.textContent = 'Saving card…';
    try {
      await auth.ready;
      const result = await api.request('/study-tools/flashcards', {
        method: 'POST',
        body: { topic: formData.get('topic'), front: formData.get('front'), back: formData.get('back') }
      });
      flashcards.unshift({ ...result.flashcard, topic: result.flashcard.topic || 'General' });
      selectedFlashcardTopic = result.flashcard.topic || 'General';
      flashcardIndex = 0;
      isCardFlipped = false;
      flashcardForm.reset();
      updateFlashcardTopics();
      topicFilter.value = selectedFlashcardTopic;
      flashcardStatus.textContent = 'Saved to your account';
      renderFlashcard();
    } catch (error) {
      flashcardStatus.textContent = 'Save failed';
      showToast(`Could not save flashcard: ${error.message}`);
    } finally {
      submitButton.disabled = false;
    }
  });
  deleteFlashcardButton.addEventListener('click', async () => {
    const cards = visibleFlashcards();
    const card = cards[flashcardIndex];
    if (!card) return;
    deleteFlashcardButton.disabled = true;
    try {
      await auth.ready;
      await api.request(`/study-tools/flashcards/${encodeURIComponent(card.id)}`, { method: 'DELETE' });
      const cardIndex = flashcards.findIndex((item) => item.id === card.id);
      if (cardIndex >= 0) flashcards.splice(cardIndex, 1);
      if (flashcardIndex >= visibleFlashcards().length) flashcardIndex = Math.max(0, visibleFlashcards().length - 1);
      isCardFlipped = false;
      updateFlashcardTopics();
      flashcardStatus.textContent = 'Card deleted';
      renderFlashcard();
    } catch (error) {
      showToast(`Could not delete flashcard: ${error.message}`);
      deleteFlashcardButton.disabled = false;
    }
  });
  void loadFlashcards();

  // Whiteboard: pen, eraser, adjustable size, and one-step-per-stroke undo.
  const canvas = document.getElementById('whiteboard');
  const context = canvas.getContext('2d');
  let isDrawing = false;
  let brushColor = '#293451';
  let brushSize = 5;
  let brushMode = 'pen';
  let undoStack = [];
  context.lineCap = 'round';
  context.lineJoin = 'round';

  function canvasPoint(event) {
    const bounds = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - bounds.left) * (canvas.width / bounds.width),
      y: (event.clientY - bounds.top) * (canvas.height / bounds.height)
    };
  }

  function saveUndoSnapshot() {
    if (undoStack.length >= 20) undoStack.shift();
    undoStack.push(context.getImageData(0, 0, canvas.width, canvas.height));
    document.getElementById('undoBoard').disabled = false;
  }

  function setBoardMode(mode) {
    brushMode = mode;
    document.querySelectorAll('[data-board-tool]').forEach((button) => {
      const selected = button.dataset.boardTool === mode;
      button.classList.toggle('is-active', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
    canvas.style.cursor = mode === 'eraser' ? 'cell' : 'crosshair';
  }

  canvas.addEventListener('pointerdown', (event) => {
    if (event.button !== undefined && event.button !== 0) return;
    saveUndoSnapshot();
    isDrawing = true;
    canvas.setPointerCapture(event.pointerId);
    const point = canvasPoint(event);
    context.beginPath();
    context.moveTo(point.x, point.y);
    context.lineWidth = brushMode === 'eraser' ? brushSize * 3 : brushSize;
    context.globalCompositeOperation = brushMode === 'eraser' ? 'destination-out' : 'source-over';
    context.strokeStyle = brushColor;
    context.lineTo(point.x + 0.01, point.y + 0.01);
    context.stroke();
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!isDrawing) return;
    const point = canvasPoint(event);
    context.lineWidth = brushMode === 'eraser' ? brushSize * 3 : brushSize;
    context.globalCompositeOperation = brushMode === 'eraser' ? 'destination-out' : 'source-over';
    context.strokeStyle = brushColor;
    context.lineTo(point.x, point.y);
    context.stroke();
  });
  function stopDrawing() {
    isDrawing = false;
    context.globalCompositeOperation = 'source-over';
    context.beginPath();
  }
  canvas.addEventListener('pointerup', stopDrawing);
  canvas.addEventListener('pointercancel', stopDrawing);
  document.querySelectorAll('[data-board-tool]').forEach((button) => {
    button.addEventListener('click', () => setBoardMode(button.dataset.boardTool));
  });
  document.querySelectorAll('.color-swatch').forEach((swatch) => {
    swatch.addEventListener('click', () => {
      brushColor = swatch.dataset.color;
      document.querySelectorAll('.color-swatch').forEach((item) => {
        const selected = item === swatch;
        item.classList.toggle('selected', selected);
        item.setAttribute('aria-pressed', String(selected));
      });
      setBoardMode('pen');
    });
  });
  const boardBrushSize = document.getElementById('boardBrushSize');
  boardBrushSize.addEventListener('input', () => {
    brushSize = Number(boardBrushSize.value) || 5;
    document.getElementById('boardBrushSizeValue').value = String(brushSize);
    document.getElementById('boardBrushSizeValue').textContent = String(brushSize);
  });
  document.getElementById('undoBoard').addEventListener('click', () => {
    const previous = undoStack.pop();
    if (previous) context.putImageData(previous, 0, 0);
    document.getElementById('undoBoard').disabled = undoStack.length === 0;
  });
  document.getElementById('clearBoard').addEventListener('click', () => {
    saveUndoSnapshot();
    context.clearRect(0, 0, canvas.width, canvas.height);
  });
  document.getElementById('openBoard').addEventListener('click', () => window.StudyloopApp.openBoard());

  renderTimer();

})();
