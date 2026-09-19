(function () {
  'use strict';

  const state = {
    payload: null,
    isAuthed: false,
    isAdmin: false,
    lbScope: 'week',
    teamsCache: null,
  };

  function client() {
    return window.ESAuth && window.ESAuth.getSupabaseClient ? window.ESAuth.getSupabaseClient() : null;
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatKickoff(iso) {
    if (!iso) return '';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
    });
  }

  function setStatus(el, message, tone) {
    if (!el) return;
    el.textContent = message || '';
    el.classList.toggle('is-error', tone === 'error');
    el.classList.toggle('is-success', tone === 'success');
  }

  // ---------------------------------------------------------------------
  // Tabs
  // ---------------------------------------------------------------------

  function setupTabs() {
    document.querySelectorAll('[data-pickem-tab]').forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.pickemTab;
        document.querySelectorAll('[data-pickem-tab]').forEach(b => {
          b.classList.toggle('is-active', b === btn);
          b.setAttribute('aria-selected', b === btn ? 'true' : 'false');
        });
        document.querySelectorAll('[data-pickem-panel]').forEach(panel => {
          panel.hidden = panel.dataset.pickemPanel !== tab;
        });
        if (tab === 'leaderboard') loadLeaderboard(state.lbScope);
        if (tab === 'results') renderResultsTab();
        if (tab === 'admin') loadAdminOptions();
      });
    });
  }

  // ---------------------------------------------------------------------
  // Week payload: header, games, tiebreaker, sticky bar
  // ---------------------------------------------------------------------

  async function loadWeekPayload(weekId) {
    const supabase = client();
    if (!supabase) return;
    const { data, error } = await supabase.rpc('pickem_get_week_payload', { p_week_id: weekId || null });
    if (error) {
      document.getElementById('pickem-week-label').textContent = 'Could not load this week.';
      return;
    }
    state.payload = data;
    renderWeekHeader(data);
    renderGamesList(data, 'pickem-games-list', { interactive: true });
    renderTiebreakerBlock(data);
    renderStickyBar(data);
  }

  function renderWeekHeader(payload) {
    const label = document.getElementById('pickem-week-label');
    if (!payload || !payload.week) {
      label.textContent = 'No open week yet';
      return;
    }
    label.textContent = `NFL PICK'EM — ${payload.week.label || `Week ${payload.week.number}`}`;

    const progressEl = document.getElementById('pickem-progress-text');
    const entry = payload.entry || {};
    if (state.isAuthed) {
      const missedText = entry.missed ? ` · ${entry.missed} missed` : '';
      progressEl.textContent = `${entry.picked_available || 0} of ${entry.available_total || 0} available picks made${missedText}`;
    } else {
      progressEl.textContent = 'Sign in to save your picks and track progress.';
    }

    const nextLockEl = document.getElementById('pickem-next-lock');
    const nextGame = (payload.games || []).find(g => !g.locked);
    nextLockEl.textContent = nextGame
      ? `Next lock: ${nextGame.away.abbr} @ ${nextGame.home.abbr} · ${formatKickoff(nextGame.kickoff_at)}`
      : '';
  }

  function gameStatusInfo(game) {
    if (game.status === 'canceled' || game.status === 'no_contest') {
      return { text: 'Not scored', cls: 'is-void' };
    }
    if (game.status === 'final') {
      if (!game.my_pick_team_id) return { text: game.winner_team_id ? 'Final' : 'Final · Void', cls: 'is-void' };
      if (game.my_pick_result === 'correct') return { text: 'Correct +1', cls: 'is-correct' };
      if (game.my_pick_result === 'incorrect') return { text: 'Incorrect', cls: 'is-incorrect' };
      return { text: 'Final', cls: 'is-void' };
    }
    if (game.locked) {
      return { text: game.status === 'in_progress' || game.status === 'halftime' ? 'Live' : 'Locked', cls: game.status === 'in_progress' || game.status === 'halftime' ? 'is-live' : 'is-locked' };
    }
    return { text: '', cls: '' };
  }

  function renderGamesList(payload, targetId, opts) {
    const target = document.getElementById(targetId);
    if (!target) return;
    const games = (payload && payload.games) || [];
    if (!games.length) {
      target.innerHTML = '<p class="pickem-status">No games scheduled for this week yet.</p>';
      return;
    }
    target.innerHTML = games.map(game => renderGameCard(game, opts || {})).join('');

    if (opts && opts.interactive) {
      target.querySelectorAll('[data-pick-team]').forEach(btn => {
        btn.addEventListener('click', () => handlePickClick(btn.dataset.pickGame, btn.dataset.pickTeam));
      });
    }
  }

  function teamButtonClasses(game, teamId) {
    const classes = ['pickem-team-btn'];
    if (game.my_pick_team_id === teamId) {
      classes.push('is-selected');
      if (game.status === 'final') {
        classes.push(game.my_pick_result === 'correct' ? 'is-correct' : game.my_pick_result === 'incorrect' ? 'is-incorrect' : '');
      }
    }
    return classes.filter(Boolean).join(' ');
  }

  function renderGameCard(game, opts) {
    const status = gameStatusInfo(game);
    const disabled = game.locked || !opts.interactive;
    const tbBadge = game.is_primary_tiebreak ? ' <span title="Primary tiebreaker">⭐ MNF</span>' : (game.is_secondary_tiebreak ? ' <span title="Backup tiebreaker">⭐ SNF</span>' : '');
    return `
      <div class="pickem-game-card" data-game-id="${escapeHtml(game.id)}">
        <div class="pickem-game-teams">
          <button type="button" class="${teamButtonClasses(game, game.away.id)}" data-pick-game="${escapeHtml(game.id)}" data-pick-team="${escapeHtml(game.away.id)}" ${disabled ? 'disabled' : ''}>
            <span class="pickem-team-abbr">${escapeHtml(game.away.abbr)}</span>
            ${game.away.score != null ? `<span class="pickem-team-score">${game.away.score}</span>` : ''}
          </button>
          <span class="pickem-vs">@</span>
          <button type="button" class="${teamButtonClasses(game, game.home.id)}" data-pick-game="${escapeHtml(game.id)}" data-pick-team="${escapeHtml(game.home.id)}" ${disabled ? 'disabled' : ''}>
            <span class="pickem-team-abbr">${escapeHtml(game.home.abbr)}</span>
            ${game.home.score != null ? `<span class="pickem-team-score">${game.home.score}</span>` : ''}
          </button>
        </div>
        <div class="pickem-game-meta">
          <span class="pickem-game-kickoff">${escapeHtml(formatKickoff(game.kickoff_at))}${tbBadge}</span>
          <span class="pickem-game-status ${status.cls}">${escapeHtml(status.text)}</span>
        </div>
      </div>
    `;
  }

  async function handlePickClick(gameId, teamId) {
    if (!state.isAuthed) {
      promptSignIn();
      return;
    }
    const card = document.querySelector(`.pickem-game-card[data-game-id="${CSS.escape(gameId)}"]`);
    const buttons = card ? card.querySelectorAll('[data-pick-team]') : [];
    const previous = state.payload.games.find(g => g.id === gameId);
    const previousPickTeamId = previous ? previous.my_pick_team_id : null;

    // Optimistic UI first (PRD 7.3): mark selected immediately.
    buttons.forEach(btn => btn.classList.toggle('is-selected', btn.dataset.pickTeam === teamId));

    const supabase = client();
    const { data, error } = await supabase.rpc('pickem_set_pick', { p_game_id: gameId, p_team_id: teamId });

    if (error) {
      buttons.forEach(btn => btn.classList.toggle('is-selected', btn.dataset.pickTeam === previousPickTeamId));
      window.setTimeout(() => alert("Couldn't save this pick. Tap to retry."), 0);
      return;
    }

    if (!data.success) {
      buttons.forEach(btn => btn.classList.toggle('is-selected', btn.dataset.pickTeam === previousPickTeamId));
      if (data.code === 'GAME_LOCKED') {
        await loadWeekPayload(state.payload.week.id);
      }
      alert(data.message || 'Could not save this pick.');
      return;
    }

    if (previous) previous.my_pick_team_id = teamId;
    if (state.payload.entry) Object.assign(state.payload.entry, data.entry);
    renderWeekHeader(state.payload);
    renderStickyBar(state.payload);
  }

  // ---------------------------------------------------------------------
  // Tiebreaker
  // ---------------------------------------------------------------------

  function tiebreakerFieldHtml(prefix, label, homeValue, awayValue, homeAbbr, awayAbbr) {
    return `
      <label>${escapeHtml(awayAbbr || 'Away')} score
        <input type="number" min="0" max="99" id="pickem-${prefix}-away" value="${awayValue ?? ''}">
      </label>
      <label>${escapeHtml(homeAbbr || 'Home')} score
        <input type="number" min="0" max="99" id="pickem-${prefix}-home" value="${homeValue ?? ''}">
      </label>
    `;
  }

  function renderTiebreakerBlock(payload) {
    const block = document.getElementById('pickem-tiebreaker-block');
    if (!payload || !payload.week) { block.hidden = true; return; }
    const games = payload.games || [];
    const primary = games.find(g => g.is_primary_tiebreak);
    const secondary = games.find(g => g.is_secondary_tiebreak);
    if (!primary && !secondary) { block.hidden = true; return; }
    block.hidden = false;

    const entry = payload.entry || {};
    const primaryEl = document.getElementById('pickem-primary-tiebreak-fields');
    const secondaryEl = document.getElementById('pickem-secondary-tiebreak-fields');

    if (primary && !primary.locked) {
      primaryEl.innerHTML = `<p style="grid-column:1/-1;font-weight:700;margin:0">Primary: ${escapeHtml(primary.away.abbr)} @ ${escapeHtml(primary.home.abbr)}</p>` +
        tiebreakerFieldHtml('primary', 'Primary', entry.primary_home_prediction, entry.primary_away_prediction, primary.home.abbr, primary.away.abbr);
    } else {
      primaryEl.innerHTML = primary ? '<p style="grid-column:1/-1">Primary tiebreaker game has locked.</p>' : '';
    }

    if (secondary && !secondary.locked) {
      secondaryEl.innerHTML = `<p style="grid-column:1/-1;font-weight:700;margin:0">Backup: ${escapeHtml(secondary.away.abbr)} @ ${escapeHtml(secondary.home.abbr)}</p>` +
        tiebreakerFieldHtml('secondary', 'Backup', entry.secondary_home_prediction, entry.secondary_away_prediction, secondary.home.abbr, secondary.away.abbr);
    } else {
      secondaryEl.innerHTML = secondary ? '<p style="grid-column:1/-1">Backup tiebreaker game has locked.</p>' : '';
    }
  }

  async function handleSaveTiebreaker() {
    const statusEl = document.getElementById('pickem-tiebreaker-status');
    if (!state.isAuthed) { promptSignIn(); return; }
    const get = id => {
      const el = document.getElementById(id);
      if (!el || el.value === '') return null;
      return Number(el.value);
    };
    const params = {
      p_week_id: state.payload.week.id,
      p_primary_home: get('pickem-primary-home'),
      p_primary_away: get('pickem-primary-away'),
      p_secondary_home: get('pickem-secondary-home'),
      p_secondary_away: get('pickem-secondary-away'),
    };
    const supabase = client();
    const { data, error } = await supabase.rpc('pickem_set_tiebreaker', params);
    if (error || !data.success) {
      setStatus(statusEl, (data && data.message) || "Couldn't save your tiebreaker. Tap to retry.", 'error');
      return;
    }
    Object.assign(state.payload.entry, data.entry);
    renderWeekHeader(state.payload);
    renderStickyBar(state.payload);
    setStatus(statusEl, 'Saved ✓', 'success');
  }

  // ---------------------------------------------------------------------
  // Sticky completion bar (PRD 7.4)
  // ---------------------------------------------------------------------

  function renderStickyBar(payload) {
    const bar = document.getElementById('pickem-sticky-bar');
    const text = document.getElementById('pickem-sticky-text');
    const btn = document.getElementById('pickem-complete-btn');
    if (!payload || !payload.week || !state.isAuthed) { bar.hidden = true; return; }
    const entry = payload.entry || {};
    bar.hidden = false;

    if (entry.status === 'complete' || entry.status === 'final') {
      text.textContent = entry.missed ? `Picks complete ✓ · ${entry.missed} missed game${entry.missed === 1 ? '' : 's'}` : 'Picks complete ✓';
      btn.hidden = true;
      return;
    }
    btn.hidden = false;
    if (entry.picked_available < entry.available_total) {
      const remaining = entry.available_total - entry.picked_available;
      text.textContent = `${remaining} pick${remaining === 1 ? '' : 's'} remaining`;
      btn.disabled = true;
    } else if (entry.tiebreaker_needed && !entry.tiebreaker_present) {
      text.textContent = 'Add your tiebreaker prediction';
      btn.disabled = true;
    } else {
      text.textContent = 'All available picks made';
      btn.disabled = false;
    }
  }

  async function handleCompleteWeek() {
    const supabase = client();
    const { data, error } = await supabase.rpc('pickem_complete_week', { p_week_id: state.payload.week.id });
    if (error || !data.success) {
      alert((data && data.message) || "Couldn't complete the week yet.");
      return;
    }
    Object.assign(state.payload.entry, data.entry);
    renderStickyBar(state.payload);
  }

  // ---------------------------------------------------------------------
  // My Results
  // ---------------------------------------------------------------------

  function renderResultsTab() {
    const summary = document.getElementById('pickem-results-summary');
    const payload = state.payload;
    if (!payload || !payload.games) { summary.innerHTML = ''; return; }
    const counts = { correct: 0, incorrect: 0, remaining: 0, missed: 0, void: 0 };
    payload.games.forEach(g => {
      if (g.status === 'canceled' || g.status === 'no_contest') counts.void += 1;
      else if (g.my_pick_result === 'correct') counts.correct += 1;
      else if (g.my_pick_result === 'incorrect') counts.incorrect += 1;
      else if (g.locked && !g.my_pick_team_id) counts.missed += 1;
      else if (!g.locked) counts.remaining += 1;
    });
    summary.innerHTML = `
      <span>Correct: ${counts.correct}</span>
      <span>Incorrect: ${counts.incorrect}</span>
      <span>Remaining: ${counts.remaining}</span>
      <span>Missed: ${counts.missed}</span>
      <span>Void: ${counts.void}</span>
    `;
    renderGamesList(payload, 'pickem-results-list', { interactive: false });
  }

  // ---------------------------------------------------------------------
  // Leaderboard
  // ---------------------------------------------------------------------

  function setupLeaderboardToggle() {
    document.querySelectorAll('[data-lb-scope]').forEach(btn => {
      btn.addEventListener('click', () => {
        state.lbScope = btn.dataset.lbScope;
        document.querySelectorAll('[data-lb-scope]').forEach(b => b.classList.toggle('is-active', b === btn));
        loadLeaderboard(state.lbScope);
      });
    });
  }

  async function loadLeaderboard(scope) {
    if (!state.payload || !state.payload.week) return;
    const supabase = client();
    const extraHeader = document.getElementById('pickem-lb-extra-header');
    const body = document.getElementById('pickem-leaderboard-body');
    body.innerHTML = '<tr><td colspan="4">Loading&hellip;</td></tr>';

    let rows = [];
    if (scope === 'season') {
      extraHeader.textContent = 'Weekly Wins';
      const { data, error } = await supabase.rpc('pickem_get_season_leaderboard', { p_season_id: state.payload.season.id, p_limit: 50 });
      rows = error ? [] : data;
      body.innerHTML = rows.length
        ? rows.map(r => `<tr class="${r.is_current_user ? 'is-current-user' : ''}"><td>${r.rank ?? '—'}</td><td>${escapeHtml(r.display_name)}</td><td>${r.correct_count}</td><td>${r.weekly_wins}</td></tr>`).join('')
        : '<tr><td colspan="4">No standings yet.</td></tr>';
    } else {
      extraHeader.textContent = 'Missed';
      const { data, error } = await supabase.rpc('pickem_get_weekly_leaderboard', { p_week_id: state.payload.week.id, p_limit: 50 });
      rows = error ? [] : data;
      body.innerHTML = rows.length
        ? rows.map(r => `<tr class="${r.is_current_user ? 'is-current-user' : ''}"><td>${r.rank ?? '—'}</td><td>${escapeHtml(r.display_name)}</td><td>${r.correct_count}</td><td>${r.missed_count}</td></tr>`).join('')
        : '<tr><td colspan="4">No results yet this week.</td></tr>';
    }
  }

  // ---------------------------------------------------------------------
  // Admin tab
  // ---------------------------------------------------------------------

  async function loadTeams() {
    if (state.teamsCache) return state.teamsCache;
    const supabase = client();
    const { data, error } = await supabase.from('pickem_teams').select('id, abbreviation, name').order('abbreviation');
    state.teamsCache = error ? [] : data;
    return state.teamsCache;
  }

  async function loadAdminOptions() {
    const supabase = client();
    const [{ data: seasons }, { data: weeks }, teams] = await Promise.all([
      supabase.from('pickem_seasons').select('id, year, season_type').order('year', { ascending: false }),
      supabase.from('pickem_weeks').select('id, week_number, label, season_id').order('week_number'),
      loadTeams(),
    ]);

    const seasonOptions = (seasons || []).map(s => `<option value="${s.id}">${s.year} ${s.season_type}</option>`).join('');
    document.getElementById('pickem-admin-week-season').innerHTML = seasonOptions;

    const weekOptions = (weeks || []).map(w => `<option value="${w.id}">${escapeHtml(w.label || `Week ${w.week_number}`)}</option>`).join('');
    ['pickem-admin-game-week', 'pickem-admin-tb-week'].forEach(id => { document.getElementById(id).innerHTML = weekOptions; });

    const teamOptions = teams.map(t => `<option value="${t.id}">${escapeHtml(t.abbreviation)} — ${escapeHtml(t.name)}</option>`).join('');
    ['pickem-admin-game-home', 'pickem-admin-game-away'].forEach(id => { document.getElementById(id).innerHTML = teamOptions; });

    await loadGameOptionsForWeek(document.getElementById('pickem-admin-tb-week').value, ['pickem-admin-tb-primary', 'pickem-admin-tb-secondary']);
    await loadAllGameOptions();

    document.getElementById('pickem-admin-tb-week').addEventListener('change', e => {
      loadGameOptionsForWeek(e.target.value, ['pickem-admin-tb-primary', 'pickem-admin-tb-secondary']);
    });
  }

  async function loadGameOptionsForWeek(weekId, targetIds) {
    if (!weekId) return;
    const supabase = client();
    const { data } = await supabase
      .from('pickem_games')
      .select('id, kickoff_at, home_team_id, away_team_id')
      .eq('week_id', weekId);
    const options = (data || []).map(g => `<option value="${g.id}">${new Date(g.kickoff_at).toLocaleString()}</option>`).join('');
    targetIds.forEach(id => { const el = document.getElementById(id); if (el) el.innerHTML = `<option value="">None</option>${options}`; });
  }

  async function loadAllGameOptions() {
    const supabase = client();
    const teams = await loadTeams();
    const teamById = new Map(teams.map(t => [t.id, t.abbreviation]));
    const { data } = await supabase.from('pickem_games').select('id, kickoff_at, home_team_id, away_team_id, status').order('kickoff_at', { ascending: false }).limit(100);
    const options = (data || []).map(g => `<option value="${g.id}">${escapeHtml(teamById.get(g.away_team_id) || '?')} @ ${escapeHtml(teamById.get(g.home_team_id) || '?')} · ${new Date(g.kickoff_at).toLocaleDateString()} · ${g.status}</option>`).join('');
    document.getElementById('pickem-admin-score-game').innerHTML = options;
  }

  function toIso(datetimeLocalValue) {
    if (!datetimeLocalValue) return null;
    return new Date(datetimeLocalValue).toISOString();
  }

  function setupAdminForms() {
    const statusEl = document.getElementById('pickem-admin-status');
    const supabase = () => client();

    document.getElementById('pickem-admin-season-form').addEventListener('submit', async e => {
      e.preventDefault();
      const { data, error } = await supabase().rpc('pickem_admin_create_season', {
        p_year: Number(document.getElementById('pickem-admin-season-year').value),
        p_season_type: document.getElementById('pickem-admin-season-type').value,
      });
      setStatus(statusEl, error || !data.success ? (data && data.message) || 'Failed to create season.' : 'Season ready.', error || !data.success ? 'error' : 'success');
      if (!error && data.success) loadAdminOptions();
    });

    document.getElementById('pickem-admin-week-form').addEventListener('submit', async e => {
      e.preventDefault();
      const { data, error } = await supabase().rpc('pickem_admin_create_week', {
        p_season_id: document.getElementById('pickem-admin-week-season').value,
        p_week_number: Number(document.getElementById('pickem-admin-week-number').value),
        p_label: document.getElementById('pickem-admin-week-label').value || null,
        p_opens_at: toIso(document.getElementById('pickem-admin-week-opens').value) || new Date().toISOString(),
      });
      setStatus(statusEl, error || !data.success ? (data && data.message) || 'Failed to create week.' : 'Week ready.', error || !data.success ? 'error' : 'success');
      if (!error && data.success) loadAdminOptions();
    });

    document.getElementById('pickem-admin-game-form').addEventListener('submit', async e => {
      e.preventDefault();
      const { data, error } = await supabase().rpc('pickem_admin_create_game', {
        p_week_id: document.getElementById('pickem-admin-game-week').value,
        p_home_team_id: document.getElementById('pickem-admin-game-home').value,
        p_away_team_id: document.getElementById('pickem-admin-game-away').value,
        p_kickoff_at: toIso(document.getElementById('pickem-admin-game-kickoff').value),
      });
      setStatus(statusEl, error || !data.success ? (data && data.message) || 'Failed to add game.' : 'Game added.', error || !data.success ? 'error' : 'success');
      if (!error && data.success) { loadAllGameOptions(); loadGameOptionsForWeek(document.getElementById('pickem-admin-tb-week').value, ['pickem-admin-tb-primary', 'pickem-admin-tb-secondary']); }
    });

    document.getElementById('pickem-admin-tiebreak-form').addEventListener('submit', async e => {
      e.preventDefault();
      const { data, error } = await supabase().rpc('pickem_admin_set_tiebreak_games', {
        p_week_id: document.getElementById('pickem-admin-tb-week').value,
        p_primary_game_id: document.getElementById('pickem-admin-tb-primary').value || null,
        p_secondary_game_id: document.getElementById('pickem-admin-tb-secondary').value || null,
      });
      setStatus(statusEl, error || !data.success ? (data && data.message) || 'Failed to save.' : 'Tiebreaker games saved.', error || !data.success ? 'error' : 'success');
    });

    document.getElementById('pickem-admin-score-form').addEventListener('submit', async e => {
      e.preventDefault();
      const { data, error } = await supabase().rpc('pickem_admin_set_final_score', {
        p_game_id: document.getElementById('pickem-admin-score-game').value,
        p_home_score: Number(document.getElementById('pickem-admin-score-home').value),
        p_away_score: Number(document.getElementById('pickem-admin-score-away').value),
        p_status: document.getElementById('pickem-admin-score-status').value,
        p_reason: document.getElementById('pickem-admin-score-reason').value,
      });
      setStatus(statusEl, error || !data.success ? (data && data.message) || 'Failed to save score.' : 'Score saved and standings recalculated.', error || !data.success ? 'error' : 'success');
      if (!error && data.success && state.payload && state.payload.week) loadWeekPayload(state.payload.week.id);
    });

    document.getElementById('pickem-admin-void-btn').addEventListener('click', async () => {
      const reason = document.getElementById('pickem-admin-score-reason').value;
      if (!reason) { setStatus(statusEl, 'Enter a reason before voiding.', 'error'); return; }
      const { data, error } = await supabase().rpc('pickem_admin_void_game', {
        p_game_id: document.getElementById('pickem-admin-score-game').value,
        p_reason: reason,
      });
      setStatus(statusEl, error || !data.success ? (data && data.message) || 'Failed to void game.' : 'Game voided and standings recalculated.', error || !data.success ? 'error' : 'success');
      if (!error && data.success && state.payload && state.payload.week) loadWeekPayload(state.payload.week.id);
    });
  }

  // ---------------------------------------------------------------------
  // Auth
  // ---------------------------------------------------------------------

  function promptSignIn() {
    window.location.href = window.ESAuth?.loginUrl?.('pickem.html') || 'login.html?redirect=pickem.html';
  }

  async function checkAuthAndAdmin() {
    const supabase = client();
    if (!supabase) return;
    // Deliberately NOT window.ESAuth.getSession(): that helper also
    // enforces the essentiallysports.com-domain/allowlist gate built for
    // the internal design-tools dashboard, which would incorrectly treat
    // a real, signed-in public Pick'em player as "no session" if their
    // email isn't ES staff. Pick'em has no such restriction at the
    // RLS/RPC layer, so it checks the raw Supabase session instead.
    const { data: { session } = {} } = await supabase.auth.getSession();
    state.isAuthed = !!session;
    document.getElementById('pickem-signin-note').hidden = state.isAuthed;
    const signInLink = document.getElementById('pickem-signin-link');
    if (signInLink) signInLink.addEventListener('click', e => { e.preventDefault(); promptSignIn(); });

    if (!state.isAuthed) return;
    const { data, error } = await supabase.rpc('is_pickem_admin');
    state.isAdmin = !error && data === true;
    document.getElementById('pickem-admin-tab').hidden = !state.isAdmin;
  }

  // ---------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------

  async function boot() {
    setupTabs();
    setupLeaderboardToggle();
    setupAdminForms();
    document.getElementById('pickem-save-tiebreaker').addEventListener('click', handleSaveTiebreaker);
    document.getElementById('pickem-complete-btn').addEventListener('click', handleCompleteWeek);

    if (window.ESAuth?.ensureSupabaseReady) {
      try { await window.ESAuth.ensureSupabaseReady(); } catch (error) { /* proceed anyway; guest view still works */ }
    }
    await checkAuthAndAdmin();
    await loadWeekPayload(null);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
