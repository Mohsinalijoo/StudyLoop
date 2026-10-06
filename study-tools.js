(() => {
  'use strict';
  const showToast = (message) => window.StudyloopApp?.showToast(message);
  // 25-minute Pomodoro-style focus sprint.
  const focusDuration = 25 * 60;
  let secondsRemaining = focusDuration;
  let timerInterval = null;
  const timerDisplay = document.getElementById('timerDisplay');
  const timerState = document.getElementById('timerState');
  const timerToggle = document.getElementById('timerToggle');
  const timerRing = document.getElementById('timerRing');

  function renderTimer() {
    const minutes = Math.floor(secondsRemaining / 60).toString().padStart(2, '0');
    const seconds = (secondsRemaining % 60).toString().padStart(2, '0');
    timerDisplay.textContent = `${minutes}:${seconds}`;
    const progress = ((focusDuration - secondsRemaining) / focusDuration) * 100;
    timerRing.style.setProperty('--progress', `${progress.toFixed(2)}%`);
  }

  function stopTimer() {
    window.clearInterval(timerInterval);
    timerInterval = null;
    timerToggle.innerHTML = 'Resume focus <span aria-hidden="true">→</span>';
    timerState.textContent = 'PAUSED · TAKE YOUR TIME';
  }

  timerToggle.addEventListener('click', () => {
    if (timerInterval) {
      stopTimer();
      return;
    }
    if (secondsRemaining <= 0) secondsRemaining = focusDuration;
    timerToggle.innerHTML = 'Pause focus <span aria-hidden="true">Ⅱ</span>';
    timerState.textContent = "FOCUSING · YOU'VE GOT THIS";
    timerInterval = window.setInterval(() => {
      secondsRemaining -= 1;
      renderTimer();
      if (secondsRemaining <= 0) {
        window.clearInterval(timerInterval);
        timerInterval = null;
        timerToggle.innerHTML = 'Start again <span aria-hidden="true">↻</span>';
        timerState.textContent = 'SPRINT COMPLETE · NICE WORK';
        showToast('Focus sprint complete. Take a little five-minute break.');
      }
    }, 1000);
  });
  document.getElementById('timerReset').addEventListener('click', () => {
    window.clearInterval(timerInterval);
    timerInterval = null;
    secondsRemaining = focusDuration;
    timerToggle.innerHTML = 'Start focus <span aria-hidden="true">→</span>';
    timerState.textContent = 'READY WHEN YOU ARE';
    renderTimer();
  });

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

  // Flashcards are private to the signed-in user; there is no bundled sample deck.
  const flashcards = [];
  let flashcardIndex = 0;
  let isCardFlipped = false;
  const flashcard = document.getElementById('flashcard');
  const flashcardLabel = document.getElementById('flashcardLabel');
  const flashcardPrompt = document.getElementById('flashcardPrompt');
  const flashcardHint = document.getElementById('flashcardHint');
  const flashcardCounter = document.getElementById('cardCounter');
  const flashcardStatus = document.getElementById('flashcardStatus');
  const nextCardButton = document.getElementById('nextCard');
  const deleteFlashcardButton = document.getElementById('deleteFlashcard');
  const flashcardForm = document.getElementById('flashcardForm');

  function renderFlashcard() {
    const hasCards = flashcards.length > 0;
    flashcard.disabled = !hasCards;
    nextCardButton.disabled = flashcards.length < 2;
    deleteFlashcardButton.disabled = !hasCards;
    flashcard.classList.toggle('is-flipped', hasCards && isCardFlipped);
    if (!hasCards) {
      flashcardLabel.textContent = 'YOUR DECK';
      flashcardPrompt.textContent = 'Add your first question below.';
      flashcardHint.textContent = 'Your cards will sync to your account';
      flashcardCounter.textContent = '0 cards';
      flashcard.setAttribute('aria-label', 'No flashcards yet');
      return;
    }
    flashcardIndex = Math.min(flashcardIndex, flashcards.length - 1);
    const card = flashcards[flashcardIndex];
    flashcardLabel.textContent = isCardFlipped ? 'ANSWER' : 'QUESTION';
    flashcardPrompt.textContent = isCardFlipped ? card.back : card.front;
    flashcardHint.textContent = isCardFlipped ? 'Nice recall · tap to see the question' : 'Tap to reveal the answer';
    flashcardCounter.textContent = `${String(flashcardIndex + 1).padStart(2, '0')} / ${String(flashcards.length).padStart(2, '0')}`;
    flashcard.setAttribute('aria-label', isCardFlipped ? 'Show flashcard question' : 'Reveal flashcard answer');
  }

  async function loadFlashcards() {
    try {
      await auth.ready;
      const cards = await api.request('/study-tools/flashcards');
      flashcards.splice(0, flashcards.length, ...cards);
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

  flashcard.addEventListener('click', () => {
    if (!flashcards.length) return;
    isCardFlipped = !isCardFlipped;
    renderFlashcard();
  });
  nextCardButton.addEventListener('click', () => {
    if (flashcards.length < 2) return;
    flashcardIndex = (flashcardIndex + 1) % flashcards.length;
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
        body: { front: formData.get('front'), back: formData.get('back') }
      });
      flashcards.unshift(result.flashcard);
      flashcardIndex = 0;
      isCardFlipped = false;
      flashcardForm.reset();
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
    const card = flashcards[flashcardIndex];
    if (!card) return;
    deleteFlashcardButton.disabled = true;
    try {
      await auth.ready;
      await api.request(`/study-tools/flashcards/${encodeURIComponent(card.id)}`, { method: 'DELETE' });
      flashcards.splice(flashcardIndex, 1);
      if (flashcardIndex >= flashcards.length) flashcardIndex = Math.max(0, flashcards.length - 1);
      isCardFlipped = false;
      flashcardStatus.textContent = 'Card deleted';
      renderFlashcard();
    } catch (error) {
      showToast(`Could not delete flashcard: ${error.message}`);
      deleteFlashcardButton.disabled = false;
    }
  });
  void loadFlashcards();

  // Interactive whiteboard canvas.
  const canvas = document.getElementById('whiteboard');
  const context = canvas.getContext('2d');
  let isDrawing = false;
  let brushColor = '#293451';
  let lastPoint = null;
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.lineWidth = 4;

  function canvasPoint(event) {
    const bounds = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - bounds.left) * (canvas.width / bounds.width),
      y: (event.clientY - bounds.top) * (canvas.height / bounds.height)
    };
  }
  canvas.addEventListener('pointerdown', (event) => {
    isDrawing = true;
    lastPoint = canvasPoint(event);
    canvas.setPointerCapture(event.pointerId);
    context.beginPath();
    context.moveTo(lastPoint.x, lastPoint.y);
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!isDrawing) return;
    const point = canvasPoint(event);
    context.strokeStyle = brushColor;
    context.lineTo(point.x, point.y);
    context.stroke();
    lastPoint = point;
  });
  function stopDrawing() {
    isDrawing = false;
    lastPoint = null;
    context.beginPath();
  }
  canvas.addEventListener('pointerup', stopDrawing);
  canvas.addEventListener('pointercancel', stopDrawing);
  document.querySelectorAll('.color-swatch').forEach((swatch) => {
    swatch.addEventListener('click', () => {
      brushColor = swatch.dataset.color;
      document.querySelectorAll('.color-swatch').forEach((item) => {
        const selected = item === swatch;
        item.classList.toggle('selected', selected);
        item.setAttribute('aria-pressed', String(selected));
      });
    });
  });
  document.getElementById('clearBoard').addEventListener('click', () => {
    context.clearRect(0, 0, canvas.width, canvas.height);
  });
  document.getElementById('openBoard').addEventListener('click', () => window.StudyloopApp.openBoard());

  renderTimer();

})();
