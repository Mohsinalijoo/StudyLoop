(() => {
    'use strict';
  
    const api = window.StudyloopAPI;
    const auth = window.StudyloopAuth;
    const toast = (message) => window.StudyloopApp?.showToast(message);
    const calendarGrid = document.getElementById('calendarGrid');
    const taskForm = document.getElementById('plannerTaskForm');
    const taskList = document.getElementById('plannerTaskList');
    const monthLabel = document.getElementById('calendarMonthLabel');
    const status = document.getElementById('plannerStatus');
    let user = null;
    let viewMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    let selectedDate = localDateKey(new Date());
    let tasks = [];
    const remindedIds = new Set();
  
    function localDateKey(date) {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    }
  
    function parseDateKey(key) {
      const [year, month, day] = key.split('-').map(Number);
      return new Date(year, month - 1, day);
    }
  
    function escapeHTML(value) {
      return String(value ?? '').replace(/[&<>"']/g, (character) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
      })[character]);
    }
  
    function addDays(date, amount) {
      const result = new Date(date.getFullYear(), date.getMonth(), date.getDate());
      result.setDate(result.getDate() + amount);
      return result;
    }
  
    function gridStart() {
      const first = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 1);
      const mondayOffset = (first.getDay() + 6) % 7;
      return addDays(first, -mondayOffset);
    }
  
    function gridEnd() {
      return localDateKey(addDays(gridStart(), 41));
    }
  
    function tasksForDate(date) {
      return tasks.filter((task) => task.date === date);
    }
  
    function renderCalendar() {
      monthLabel.textContent = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(viewMonth);
      const start = gridStart();
      const today = localDateKey(new Date());
      const cells = [];
      for (let index = 0; index < 42; index += 1) {
        const date = addDays(start, index);
        const key = localDateKey(date);
        const dayTasks = tasksForDate(key);
        const isOtherMonth = date.getMonth() !== viewMonth.getMonth();
        const classes = [
          'calendar-day',
          isOtherMonth ? 'is-other-month' : '',
          key === selectedDate ? 'is-selected' : '',
          key === today ? 'is-today' : ''
        ].filter(Boolean).join(' ');
        cells.push(`<button class="${classes}" type="button" role="gridcell" data-calendar-date="${key}" aria-selected="${key === selectedDate}" aria-label="${escapeHTML(date.toLocaleDateString())}${dayTasks.length ? `, ${dayTasks.length} task${dayTasks.length === 1 ? '' : 's'}` : ''}"><span>${date.getDate()}</span>${dayTasks.length ? `<i class="calendar-day-dot" aria-hidden="true"></i><small>${dayTasks.length}</small>` : ''}</button>`);
      }
      calendarGrid.innerHTML = cells.join('');
      renderAgenda();
    }
  
    function renderAgenda() {
      const date = parseDateKey(selectedDate);
      document.getElementById('selectedDateLabel').textContent = new Intl.DateTimeFormat(undefined, {
        weekday: 'short', month: 'short', day: 'numeric'
      }).format(date);
      document.getElementById('agendaTitle').textContent = selectedDate === localDateKey(new Date())
        ? "Today's timetable" : 'Selected day timetable';
      document.getElementById('plannerTaskDate').value = selectedDate;
      const dayTasks = tasksForDate(selectedDate).sort((left, right) => {
        if (!left.startTime && !right.startTime) return new Date(left.createdAt) - new Date(right.createdAt);
        if (!left.startTime) return 1;
        if (!right.startTime) return -1;
        return left.startTime.localeCompare(right.startTime);
      });
      if (!dayTasks.length) {
        taskList.innerHTML = '<p class="planner-empty">Nothing planned for this date yet. Add a task above.</p>';
        return;
      }
      taskList.innerHTML = dayTasks.map((task) => `
        <article class="planner-task ${task.completed ? 'is-complete' : ''}">
          <label class="planner-task-check"><input type="checkbox" data-task-toggle="${escapeHTML(task.id)}" ${task.completed ? 'checked' : ''} aria-label="Mark ${escapeHTML(task.title)} ${task.completed ? 'not done' : 'done'}"><span aria-hidden="true"></span></label>
          <div class="planner-task-copy"><div class="planner-task-title-row">${task.startTime ? `<time>${escapeHTML(task.startTime)}</time>` : '<span class="planner-unscheduled">Any time</span>'}<strong>${escapeHTML(task.title)}</strong></div>${task.details ? `<p>${escapeHTML(task.details)}</p>` : ''}${task.reminderAt ? `<small class="planner-task-reminder">Reminder · ${escapeHTML(new Date(task.reminderAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }))}</small>` : ''}</div>
          <button class="planner-task-delete" type="button" data-delete-task="${escapeHTML(task.id)}" aria-label="Delete ${escapeHTML(task.title)}">×</button>
        </article>`).join('');
    }
  
    async function loadTasks() {
      const from = localDateKey(gridStart());
      const to = gridEnd();
      status.textContent = 'Loading your calendar…';
      try {
        tasks = await api.request(`/planner/tasks?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
        if (!Array.isArray(tasks)) tasks = [];
        status.textContent = `${tasks.length} task${tasks.length === 1 ? '' : 's'} in this calendar view · reminders run while the site is open`;
        renderCalendar();
        checkReminders();
      } catch (error) {
        status.textContent = 'Could not load your calendar.';
        taskList.innerHTML = '<p class="planner-empty">Your tasks could not be loaded. Try again in a moment.</p>';
        toast(`Calendar unavailable: ${error.message}`);
      }
    }
  
    async function addTask(event) {
      event.preventDefault();
      const fields = taskForm.elements;
      const submit = document.getElementById('plannerAddTask');
      submit.disabled = true;
      status.textContent = 'Saving your task…';
      try {
        const titleInput = fields.namedItem('title');
        const detailsInput = fields.namedItem('details');
        const dateInput = fields.namedItem('date');
        const timeInput = fields.namedItem('startTime');
        const reminderField = fields.namedItem('reminderAt');
        const reminderLocal = reminderField.value;
        if (reminderLocal && window.Notification && window.Notification.permission === 'default') {
          try { await window.Notification.requestPermission(); } catch { /* task creation should not depend on notification permission */ }
        }
        const reminderAt = reminderLocal ? new Date(reminderLocal).toISOString() : null;
        const result = await api.request('/planner/tasks', {
          method: 'POST',
          body: {
            title: titleInput.value.trim(),
            details: detailsInput.value.trim(),
            date: dateInput.value,
            startTime: timeInput.value,
            reminderAt
          }
        });
        tasks.push(result.task);
        taskForm.reset();
        selectedDate = result.task.date || selectedDate;
        const taskDate = parseDateKey(selectedDate);
        const selectedMonthChanged = taskDate.getMonth() !== viewMonth.getMonth() || taskDate.getFullYear() !== viewMonth.getFullYear();
        if (selectedMonthChanged) viewMonth = new Date(taskDate.getFullYear(), taskDate.getMonth(), 1);
        fields.namedItem('date').value = selectedDate;
        status.textContent = 'Task added to your calendar.';
        if (selectedMonthChanged) await loadTasks();
        else {
          renderCalendar();
          checkReminders();
        }
      } catch (error) {
        status.textContent = 'Could not save task.';
        toast(`Could not add task: ${error.message}`);
      } finally {
        submit.disabled = false;
      }
    }
  
    async function updateTaskCompletion(taskId, completed) {
      try {
        const result = await api.request(`/planner/tasks/${encodeURIComponent(taskId)}`, {
          method: 'PATCH', body: { completed }
        });
        tasks = tasks.map((task) => task.id === taskId ? result.task : task);
        renderCalendar();
      } catch (error) {
        toast(`Could not update task: ${error.message}`);
        renderCalendar();
      }
    }
  
    async function deleteTask(taskId) {
      const task = tasks.find((item) => item.id === taskId);
      if (!task) return;
      try {
        await api.request(`/planner/tasks/${encodeURIComponent(taskId)}`, { method: 'DELETE' });
        tasks = tasks.filter((item) => item.id !== taskId);
        renderCalendar();
        status.textContent = 'Task deleted.';
      } catch (error) {
        toast(`Could not delete task: ${error.message}`);
      }
    }
  
    function reminderKey(task) { return `${user?.id || 'user'}:${task.id}:${task.reminderAt}`; }
  
    function checkReminders() {
      const now = Date.now();
      for (const task of tasks) {
        if (!task.reminderAt || task.completed) continue;
        const key = reminderKey(task);
        if (remindedIds.has(key) || new Date(task.reminderAt).getTime() > now) continue;
        remindedIds.add(key);
        const message = `Studyloop reminder: ${task.title}`;
        if (window.Notification && window.Notification.permission === 'granted') {
          new window.Notification('Studyloop planner', { body: message, tag: key });
        } else {
          toast(message);
        }
      }
    }
  
    async function loadLeaderboard() {
      const list = document.getElementById('leaderboardList');
      const leaderboardStatus = document.getElementById('leaderboardStatus');
      if (!list) return;
      try {
        const entries = await api.request('/stats/leaderboard');
        if (!Array.isArray(entries) || !entries.length) {
          list.innerHTML = '<li class="leaderboard-empty">No completed study time yet. Join a session to make the leaderboard.</li>';
          leaderboardStatus.textContent = 'Ranks update from active Studyloop study-session time.';
          return;
        }
        list.innerHTML = entries.slice(0, 5).map((entry) => {
          const hours = Number(entry.studyHours) || 0;
          const duration = hours >= 1 ? `${hours.toFixed(1)} hr${hours === 1 ? '' : 's'}` : `${Math.round((Number(entry.studySeconds) || 0) / 60)} min`;
          const streak = Number(entry.loginStreak) || 0;
          return `<li class="leaderboard-row leaderboard-rank-${entry.rank}"><span class="leaderboard-person"><b class="leaderboard-rank">${entry.rank}</b><span class="leaderboard-avatar">${escapeHTML(String(entry.user?.displayName || 'S').trim().slice(0, 1).toUpperCase())}</span><strong>${escapeHTML(entry.user?.displayName || 'Studyloop student')}</strong></span><strong class="leaderboard-hours">${duration}</strong><span class="leaderboard-streak">🔥 ${streak} day${streak === 1 ? '' : 's'}</span></li>`;
        }).join('');
        leaderboardStatus.textContent = 'Study time counts minutes recorded in active group rooms and 1:1 sessions.';
      } catch (error) {
        list.innerHTML = '<li class="leaderboard-empty">The leaderboard is unavailable right now.</li>';
        leaderboardStatus.textContent = error.message || 'Could not load rankings.';
      }
    }
  
    async function initializePlanner() {
      try {
        user = await auth.ready;
        if (!user) return;
        taskForm.elements.namedItem('date').value = selectedDate;
        renderCalendar();
        await Promise.all([loadTasks(), loadLeaderboard()]);
        window.setInterval(checkReminders, 15000);
        window.setInterval(() => {
          if (document.visibilityState === 'visible') void loadLeaderboard();
        }, 60000);
        document.addEventListener('visibilitychange', checkReminders);
      } catch (error) {
        status.textContent = 'Planner could not start.';
        toast(error.message || 'Planner could not start.');
      }
    }
  
    calendarGrid.addEventListener('click', (event) => {
      const button = event.target.closest('[data-calendar-date]');
      if (!button) return;
      selectedDate = button.dataset.calendarDate;
      const date = parseDateKey(selectedDate);
      if (date.getMonth() !== viewMonth.getMonth() || date.getFullYear() !== viewMonth.getFullYear()) {
        viewMonth = new Date(date.getFullYear(), date.getMonth(), 1);
        void loadTasks();
      }
      renderCalendar();
    });
    document.getElementById('calendarPrevMonth').addEventListener('click', () => {
      viewMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1);
      selectedDate = localDateKey(viewMonth);
      void loadTasks();
    });
    document.getElementById('calendarNextMonth').addEventListener('click', () => {
      viewMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1);
      selectedDate = localDateKey(viewMonth);
      void loadTasks();
    });
    document.getElementById('calendarToday').addEventListener('click', () => {
      const today = new Date();
      viewMonth = new Date(today.getFullYear(), today.getMonth(), 1);
      selectedDate = localDateKey(today);
      void loadTasks();
    });
    taskForm.addEventListener('submit', (event) => void addTask(event));
    taskList.addEventListener('change', (event) => {
      const checkbox = event.target.closest('[data-task-toggle]');
      if (checkbox) void updateTaskCompletion(checkbox.dataset.taskToggle, checkbox.checked);
    });
    taskList.addEventListener('click', (event) => {
      const button = event.target.closest('[data-delete-task]');
      if (button) void deleteTask(button.dataset.deleteTask);
    });
    document.getElementById('refreshLeaderboard').addEventListener('click', () => void loadLeaderboard());
  
    void initializePlanner();
  })();
  