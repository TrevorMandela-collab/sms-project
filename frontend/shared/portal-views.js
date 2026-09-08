/* =========================================================
   Shared read-only view renderers for the student & parent
   portals. Both portals fetch the same six collections
   (already scoped server-side to the logged-in user's own
   record, or their childIds) and hand the records to these
   functions to render — the only difference between the two
   portals is how they gather/filter the data beforehand.
========================================================= */

const PortalViews = {
  letterGrade(pct) {
    if (pct >= 80) return 'A';
    if (pct >= 65) return 'B';
    if (pct >= 50) return 'C';
    if (pct >= 35) return 'D';
    return 'E';
  },

  fmtDate(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  },

  money(n) {
    return `KSh ${Number(n || 0).toLocaleString('en-KE')}`;
  },

  empty(container, message) {
    container.innerHTML = `<div class="empty-state">${message}</div>`;
  },

  renderAttendance(container, records) {
    if (!records.length) return this.empty(container, 'No attendance records yet.');
    const present = records.filter(r => r.status === 'present').length;
    const late = records.filter(r => r.status === 'late').length;
    const absent = records.filter(r => r.status === 'absent').length;
    const sorted = [...records].sort((a, b) => (b.date || '').localeCompare(a.date || ''));

    container.innerHTML = `
      <section class="stat-strip">
        <div class="stat-card"><span class="stat-value">${present}</span><span class="stat-label">Present</span></div>
        <div class="stat-card"><span class="stat-value">${late}</span><span class="stat-label">Late</span></div>
        <div class="stat-card"><span class="stat-value">${absent}</span><span class="stat-label">Absent</span></div>
      </section>
      <table class="ledger-table">
        <thead><tr><th>Date</th><th>Class</th><th>Status</th></tr></thead>
        <tbody>
          ${sorted.map(r => `
            <tr>
              <td>${this.fmtDate(r.date)}</td>
              <td>${r.className || '—'}</td>
              <td><span class="status-pill status-pill--${r.status === 'present' ? 'paid' : r.status === 'late' ? 'pending' : 'overdue'}">${r.status}</span></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  },

  renderExams(container, records) {
    if (!records.length) return this.empty(container, 'No exam results yet.');
    const sorted = [...records].sort((a, b) => (b.term || '').localeCompare(a.term || ''));
    container.innerHTML = `
      <table class="ledger-table">
        <thead><tr><th>Subject</th><th>Exam</th><th>Term</th><th>Score</th><th>Grade</th></tr></thead>
        <tbody>
          ${sorted.map(e => {
            const pct = Math.round((Number(e.score) / Number(e.maxScore || 100)) * 100);
            const grade = this.letterGrade(pct);
            return `
              <tr>
                <td>${e.subject || '—'}</td>
                <td>${e.examName || '—'}</td>
                <td>${e.term || '—'}</td>
                <td>${e.score}/${e.maxScore} (${pct}%)</td>
                <td><span class="grade-badge grade-badge--${grade.toLowerCase()}">${grade}</span></td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    `;
  },

  renderFees(container, records) {
    if (!records.length) return this.empty(container, 'No fee records yet.');
    const outstanding = records.filter(f => f.status !== 'paid').reduce((s, f) => s + Number(f.amount || 0), 0);
    const sorted = [...records].sort((a, b) => (a.due || '').localeCompare(b.due || ''));
    container.innerHTML = `
      <section class="stat-strip">
        <div class="stat-card"><span class="stat-value">${this.money(outstanding)}</span><span class="stat-label">Outstanding</span></div>
      </section>
      <table class="ledger-table">
        <thead><tr><th>Amount</th><th>Due</th><th>Status</th></tr></thead>
        <tbody>
          ${sorted.map(f => `
            <tr>
              <td>${this.money(f.amount)}</td>
              <td>${this.fmtDate(f.due)}</td>
              <td><span class="status-pill status-pill--${f.status}">${f.status}</span></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  },

  renderTimetable(container, records) {
    if (!records.length) return this.empty(container, 'No timetable published for this class yet.');
    const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
    const byDay = DAYS.map(day => ({
      day,
      slots: records.filter(r => r.day === day).sort((a, b) => (a.startTime || '').localeCompare(b.startTime || '')),
    }));
    container.innerHTML = `
      <div class="timetable-grid">
        ${byDay.map(({ day, slots }) => `
          <div class="timetable-day">
            <h4>${day}</h4>
            ${slots.length ? slots.map(s => `
              <div class="timetable-slot">
                <span class="timetable-slot-time">${s.startTime || ''}${s.endTime ? '–' + s.endTime : ''}</span>
                <span class="timetable-slot-subject">${s.subject || '—'}</span>
              </div>
            `).join('') : '<p class="chalk-sub" style="font-size:0.75rem;">No classes</p>'}
          </div>
        `).join('')}
      </div>
    `;
  },

  renderAssignments(container, assignments, submissions, classesById, subjectsById, studentId) {
    if (!assignments.length) return this.empty(container, 'No assignments yet.');
    const today = new Date().toISOString().slice(0, 10);
    const sorted = [...assignments].sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''));
    container.innerHTML = `
      <table class="ledger-table">
        <thead><tr><th>Title</th><th>Class</th><th>Due</th><th>Status</th><th>Score</th></tr></thead>
        <tbody>
          ${sorted.map(a => {
            const cls = classesById[a.classId];
            const sub = submissions.find(s => s.assignmentId === a.id && s.studentId === studentId);
            const overdue = a.dueDate < today;
            let statusLabel, statusClass;
            if (sub?.submitted) { statusLabel = 'Submitted'; statusClass = 'paid'; }
            else if (overdue) { statusLabel = 'Overdue'; statusClass = 'overdue'; }
            else { statusLabel = 'Pending'; statusClass = 'pending'; }
            return `
              <tr>
                <td>${a.title}</td>
                <td>${cls ? cls.name : '—'}</td>
                <td>${this.fmtDate(a.dueDate)}</td>
                <td><span class="status-pill status-pill--${statusClass}">${statusLabel}</span></td>
                <td>${sub && sub.score != null ? `${sub.score}/${a.maxScore}` : '—'}</td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    `;
  },

  renderAnnouncements(container, records) {
    if (!records.length) return this.empty(container, 'No announcements yet.');
    const sorted = [...records].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    container.innerHTML = `
      <div class="announcement-feed">
        ${sorted.map(a => `
          <div class="announcement-card">
            <div class="announcement-card-head">
              <h4>${a.title}</h4>
              <span class="tag-chip tag-chip--${a.tag || 'general'}">${a.tag || 'general'}</span>
            </div>
            <p>${a.body || ''}</p>
            <div class="announcement-footer"><span>${this.fmtDate(a.date)}</span></div>
          </div>
        `).join('')}
      </div>
    `;
  },
};
