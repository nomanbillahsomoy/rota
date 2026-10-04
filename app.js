/**
 * Somoy TV - Web Desk Duty Management System
 * High-Performance Supabase Client Application
 */

const SUPABASE_URL = "https://hqhaghfbumuidfkgbpav.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_A5qFYUBUnrKYUSmBUuAtFg_ea-cjKhu";

let dbClient = null;

// System State
let DB = {
  desks: [],
  shifts: [],
  staff: [],
  roster: [],
  leaves: [],
  dayOffs: [],
  exceptions: [],
  auditLogs: [],
  nameMappings: [],
  warnings: [],
  config: {}
};

window.addEventListener('unhandledrejection', function(event) { alert('Unhandled promise rejection: ' + event.reason); });
  window.onerror = function(msg, url, lineNo, columnNo, error) {
  const root = document.getElementById('viewRoot');
  if (root && root.innerHTML === '') {
    root.innerHTML = `<div style="color:red; padding:20px;"><h3>JS Error</h3><p>${msg}</p><p>Line: ${lineNo}</p></div>`;
  }
  console.error("Global error:", msg, error);
  return false;
};

let STATE = {
  date: null,
  view: "dashboard",
  deskFilter: "",
  statusFilter: "",
  visualSortBy: 'desk'
};

// ==============================================================================
// 1. DATE & TIME UTILITIES (Asia/Dhaka)
// ==============================================================================
const WEEKDAY_NAMES = ['Saturday', 'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

function todayStr() {
  const d = new Date();
  // Get Dhaka time YYYY-MM-DD
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).formatToParts(d);
  const y = parts.find(p => p.type === 'year').value;
  const m = parts.find(p => p.type === 'month').value;
  const day = parts.find(p => p.type === 'day').value;
  return `${y}-${m}-${day}`;
}

function nowMinutesOfDay() {
  const d = new Date();
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Dhaka',
    hour12: false,
    hour: '2-digit',
    minute: '2-digit'
  }).formatToParts(d);
  const h = parseInt(parts.find(p => p.type === 'hour').value, 10);
  const m = parseInt(parts.find(p => p.type === 'minute').value, 10);
  return h * 60 + m;
}

function parseDateStr(str) {
  const parts = str.split('-');
  const d = new Date(Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]), 12, 0, 0));
  return d;
}

function addDaysToStr(dateStr, n) {
  const d = parseDateStr(dateStr);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function weekdayIndexOf(dateStr) {
  const d = parseDateStr(dateStr);
  const jsDay = d.getUTCDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  // Map to Saturday-first: Sat(6)->0, Sun(0)->1, Mon(1)->2, Tue(2)->3, Wed(3)->4, Thu(4)->5, Fri(5)->6
  const map = { 6: 0, 0: 1, 1: 2, 2: 3, 3: 4, 4: 5, 5: 6 };
  return map[jsDay];
}

function weekStartStr(dateStr) {
  const idx = weekdayIndexOf(dateStr);
  return addDaysToStr(dateStr, -idx);
}

function weeksBetween(dateStrA, dateStrB) {
  const a = parseDateStr(weekStartStr(dateStrA)).getTime();
  const b = parseDateStr(weekStartStr(dateStrB)).getTime();
  return Math.round((a - b) / (7 * 24 * 3600 * 1000));
}

function parseTimeToMinutes(hhmm) {
  if (!hhmm) return null;
  const p = String(hhmm).split(':');
  return Number(p[0]) * 60 + Number(p[1]);
}

function toHHMM(mins) {
  const h = Math.floor(mins / 60), m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function fmtDateDisplay(dateStr) {
  if (!dateStr) return '';
  const d = parseDateStr(dateStr);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

function toBool(v) {
  return v === true || String(v).toUpperCase() === 'Y' || String(v).toUpperCase() === 'TRUE';
}

function isBlank(v) {
  return v === undefined || v === null || String(v).trim() === '';
}

function esc(s) {
  return (s === undefined || s === null) ? '' : String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}


async function logAudit(action, staff_id, date, desk_id, original_value, new_value, reason, notes) {
  try {
    const user_email = currentUser ? currentUser.email : 'Unknown';
    const log = {
      timestamp: new Date().toISOString().replace('T', ' ').slice(0, 16),
      user_email, action, staff_id, date, desk_id, original_value, new_value, reason, notes, source: 'UI'
    };
    await dbClient.from('audit_logs').insert([log]);
  } catch (err) {
    console.error('Audit Log Error:', err);
  }
}

function toast(msg, isError = false) {
  const host = document.getElementById('toastHost') || document.body;
  const el = document.createElement('div');
  el.className = 'toast';
  if (isError) el.style.background = '#dc2626';
  el.innerHTML = `${isError ? '' : ''} <span>${esc(msg)}</span>`;
  host.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

// ==============================================================================
// 2. CORE BUSINESS ENGINE (Schedule, Roster, Exceptions, Conflicts)
// ==============================================================================

const STATUS_BADGES = {
  UPCOMING: { label: 'Upcoming', color: '#3b82f6', dot: '' },
  ON_DUTY: { label: 'On Duty', color: '#22c55e', dot: '' },
  COMPLETED: { label: 'Completed', color: '#94a3b8', dot: '' },
  ON_LEAVE: { label: 'On Leave', color: '#ef4444', dot: '' },
  DAY_OFF: { label: 'Day Off', color: '#64748b', dot: '' },
  LATE: { label: 'Late', color: '#f97316', dot: '' },
  EARLY_EXIT: { label: 'Early Exit', color: '#f97316', dot: '' },
  SHIFT_CHANGED: { label: 'Shift Changed', color: '#eab308', dot: '' },
  DESK_CHANGED: { label: 'Desk Changed', color: '#eab308', dot: '' },
  REPLACED: { label: 'Replaced', color: '#a855f7', dot: '' },
  SWAPPED: { label: 'Swapped', color: '#a855f7', dot: '' },
  ADDITIONAL_DUTY: { label: 'Additional Duty', color: '#06b6d4', dot: '' },
  POST_NIGHT: { label: 'Post-Night Duty', color: '#06b6d4', dot: '' },
  OFF_DUTY: { label: 'Weekly Off', color: '#94a3b8', dot: '' },
  CONFLICT: { label: 'Conflict', color: '#dc2626', dot: '' }
};

function getStaffById(staffId) {
  return DB.staff.find(s => s.staff_id === staffId) || null;
}

function getDeskById(deskId) {
  return DB.desks.find(d => d.desk_id === deskId) || null;
}

function getShiftByCode(code) {
  if (!code) return null;
  return DB.shifts.find(s => s.shift_code === code) || null;
}

function getConfig(key) {
  return DB.config[key] || '';
}

function getNightPatternForDate(dateStr) {
  const anchor = getConfig('NIGHT_CYCLE_ANCHOR_DATE');
  if (isBlank(anchor)) return null;
  const anchorPattern = getConfig('NIGHT_CYCLE_ANCHOR_PATTERN') || 'A';
  const cycleLen = Number(getConfig('NIGHT_CYCLE_LENGTH_WEEKS') || '2');
  const diff = weeksBetween(dateStr, anchor);
  const idx = ((diff % cycleLen) + cycleLen) % cycleLen;
  if (idx === 0) return anchorPattern;
  return anchorPattern === 'A' ? 'B' : 'A';
}

function resolvePermanentDutyForDate(staffId, dateStr) {
  const staff = getStaffById(staffId);
  if (!staff) return { shiftType: 'UNKNOWN', warning: 'Unknown staff ID ' + staffId };
  const weekday = WEEKDAY_NAMES[weekdayIndexOf(dateStr)];
  const row = DB.roster.find(r => r.staff_id === staffId && r.weekday === weekday);
  const deskId = staff.desk_id;
  if (!row) return { shiftType: 'OFF', shiftCode: '', start: null, end: null, deskId: deskId, crossMidnight: false, warning: 'No permanent roster row.' };

  if (row.shift_type === 'OFF') {
    return { shiftType: 'OFF', shiftCode: '', start: null, end: null, deskId: deskId, crossMidnight: false };
  }

  if (row.shift_type === 'NIGHT_CONDITIONAL') {
    const pattern = getNightPatternForDate(dateStr);
    if (pattern === null) {
      return {
        shiftType: 'OFF', shiftCode: '', start: null, end: null, deskId: deskId, crossMidnight: false,
        warning: 'NIGHT_CYCLE_ANCHOR_DATE not set  treating conditional Night as OFF.'
      };
    }
    if (pattern === row.night_pattern) {
      const pCode = row.shift_code || '11pm';
      const pShift = getShiftByCode(pCode);
      return {
        shiftType: (pCode === '11pm' || (pShift && pShift.cross_midnight === 'Y')) ? 'NIGHT' : (pCode === 'OFF' ? 'OFF' : 'FIXED'),
        shiftCode: pCode === 'OFF' ? '' : pCode,
        start: pShift ? pShift.start_time : (pCode === '11pm' ? '23:00' : null),
        end: pShift ? pShift.end_time : (pCode === '11pm' ? '07:00' : null),
        deskId: deskId,
        crossMidnight: pShift ? (pShift.cross_midnight === 'Y') : (pCode === '11pm'),
        nightCyclePatternUsed: pattern
      };
    } else {
      const fallbackCode = row.non_night_fallback_shift_code || getConfig('NIGHT_FALLBACK_SHIFT_CODE') || 'E';
      const fShift = getShiftByCode(fallbackCode);
      return {
        shiftType: (fallbackCode === '11pm' || (fShift && fShift.cross_midnight === 'Y')) ? 'NIGHT' : (fallbackCode === 'OFF' ? 'OFF' : 'FIXED'),
        shiftCode: fallbackCode === 'OFF' ? '' : fallbackCode,
        start: fShift ? fShift.start_time : null,
        end: fShift ? fShift.end_time : null,
        deskId: deskId,
        crossMidnight: fShift ? (fShift.cross_midnight === 'Y') : false,
        nightCyclePatternUsed: pattern
      };
    }
  }

  const shift = getShiftByCode(row.shift_code);
  if (!shift) return { shiftType: 'OFF', shiftCode: '', start: null, end: null, deskId: deskId, crossMidnight: false, warning: 'Unknown shift ' + row.shift_code };
  return { shiftType: 'FIXED', shiftCode: row.shift_code, start: shift.start_time, end: shift.end_time, deskId: deskId, crossMidnight: toBool(shift.cross_midnight) };
}

function getActiveLeaveForStaffDate(staffId, dateStr) {
  return DB.leaves.find(l => l.staff_id === staffId && l.status === 'ACTIVE' && l.from_date <= dateStr && l.to_date >= dateStr) || null;
}

function getActiveDayOffForStaffDate(staffId, dateStr) {
  return DB.dayOffs.find(d => d.staff_id === staffId && d.date === dateStr && d.status === 'ACTIVE') || null;
}

function getActiveExceptionsForDate(dateStr) {
  return DB.exceptions.filter(e => e.date === dateStr && e.status === 'ACTIVE');
}

function getActiveExceptionForStaffDate(staffId, dateStr) {
  const rows = getActiveExceptionsForDate(dateStr).filter(e => e.staff_id === staffId);
  if (!rows.length) return null;
  const order = ['REPLACEMENT', 'SWAP', 'SHIFT_CHANGE', 'DESK_CHANGE', 'LATE_ARRIVAL', 'EARLY_EXIT', 'ADDITIONAL_DUTY'];
  rows.sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type));
  return rows[0];
}

function postNightWindowFor(staffId) {
  const staff = getStaffById(staffId);
  const start = (staff && !isBlank(staff.post_night_start_override)) ? staff.post_night_start_override : (getConfig('DEFAULT_POST_NIGHT_START') || '17:00');
  const durH = (staff && !isBlank(staff.post_night_duration_override)) ? Number(staff.post_night_duration_override) : Number(getConfig('DEFAULT_POST_NIGHT_DURATION_HOURS') || 6);
  const startMin = parseTimeToMinutes(start);
  const endMin = (startMin + durH * 60) % (24 * 60);
  return { start: start, end: toHHMM(endMin), durationHours: durH };
}

function nightSourceForDate(staffId, dateStr) {
  if (getActiveLeaveForStaffDate(staffId, dateStr)) return null;
  if (getActiveDayOffForStaffDate(staffId, dateStr)) return null;
  const ex = getActiveExceptionForStaffDate(staffId, dateStr);
  if (ex) {
    const code = ex.new_shift_code || ex.original_shift_code;
    return code === '11pm' ? 'EXCEPTION' : null;
  }
  const perm = resolvePermanentDutyForDate(staffId, dateStr);
  return perm.shiftType === 'NIGHT' ? 'STRUCTURAL' : null;
}

function classifyPostNight(staffId, dateStr, permanentToday) {
  const yesterday = addDaysToStr(dateStr, -1);
  const source = nightSourceForDate(staffId, yesterday);
  if (!source) return { mode: 'NONE' };
  if (permanentToday.shiftType === 'NIGHT') return { mode: 'NONE' };
  if (permanentToday.shiftType === 'OFF') return { mode: 'REST_DAY' };

  const window = postNightWindowFor(staffId);
  if (source === 'STRUCTURAL') {
    if (permanentToday.start === window.start && permanentToday.end === window.end) {
      return { mode: 'ENCODED_POST_NIGHT', shiftCode: permanentToday.shiftCode };
    }
    return { mode: 'AMBIGUOUS_MISMATCH', shiftCode: permanentToday.shiftCode, window: window };
  }
  return { mode: 'AUTO_GENERATE', window: window };
}

function getEffectiveDutyForStaff(staffId, dateStr) {
  const staff = getStaffById(staffId);
  if (!staff) return null;
  const desk = getDeskById(staff.desk_id);
  const base = {
    staffId: staffId, name: staff.display_name, alias: staff.alias, role: staff.role,
    inCharge: toBool(staff.in_charge), deskId: staff.desk_id, deskName: desk ? desk.display_name : staff.desk_id,
    date: dateStr, changeType: 'NONE', remarks: '', coveredBy: '', covering: '', warning: ''
  };

  const permanent = resolvePermanentDutyForDate(staffId, dateStr);
  base.scheduledShiftCode = permanent.shiftType === 'NIGHT' ? '11pm' : permanent.shiftCode;
  base.scheduledStart = permanent.start;
  base.scheduledEnd = permanent.end;

  // 1. Leave
  const leave = getActiveLeaveForStaffDate(staffId, dateStr);
  if (leave) {
    base.changeType = 'ON_LEAVE';
    base.effectiveShiftCode = ''; base.effectiveStart = null; base.effectiveEnd = null; base.effectiveDeskId = staff.desk_id;
    base.remarks = leave.leave_type + (leave.reason ? (': ' + leave.reason) : '');
    if (leave.replacement_staff_id) {
      const rep = getStaffById(leave.replacement_staff_id);
      base.coveredBy = rep ? rep.display_name : leave.replacement_staff_id;
    }
    return base;
  }

  // 2. Day Off
  const dayOff = getActiveDayOffForStaffDate(staffId, dateStr);
  if (dayOff) {
    base.changeType = 'DAY_OFF';
    base.effectiveShiftCode = ''; base.effectiveStart = null; base.effectiveEnd = null; base.effectiveDeskId = staff.desk_id;
    base.remarks = toBool(dayOff.related_night_duty) ? 'Day off after Night duty.' : (dayOff.reason || '');
    return base;
  }

  // 3. Exceptions
  const ex = getActiveExceptionForStaffDate(staffId, dateStr);
  if (ex) {
    base.changeType = ex.type;
    base.exceptionId = ex.exception_id;
    base.effectiveDeskId = ex.new_desk_id || base.deskId;
    base.effectiveShiftCode = ex.new_shift_code || base.scheduledShiftCode;
    base.effectiveStart = ex.new_start || base.scheduledStart;
    base.effectiveEnd = ex.new_end || base.scheduledEnd;
    base.remarks = ex.reason || '';

    if (ex.type === 'REPLACEMENT') {
      const abs = getStaffById(ex.related_staff_id);
      base.covering = abs ? abs.display_name : ex.related_staff_id;
    }
    if (ex.type === 'SWAP') {
      const partner = getStaffById(ex.related_staff_id);
      base.remarks = (base.remarks ? base.remarks + ' | ' : '') + 'Swapped with ' + (partner ? partner.display_name : ex.related_staff_id);
    }
    return base;
  }

  // 4. Post-night rule
  if ((getConfig('POST_NIGHT_ENABLED') || 'Y') === 'Y') {
    const pn = classifyPostNight(staffId, dateStr, permanent);
    if (pn.mode === 'ENCODED_POST_NIGHT') {
      base.changeType = 'POST_NIGHT';
      base.effectiveDeskId = staff.desk_id;
      base.effectiveShiftCode = pn.shiftCode;
      base.effectiveStart = permanent.start; base.effectiveEnd = permanent.end;
      base.remarks = 'Post-night duty (already encoded in roster as ' + pn.shiftCode + ').';
      return base;
    }
    if (pn.mode === 'AUTO_GENERATE') {
      base.changeType = 'POST_NIGHT';
      base.effectiveDeskId = staff.desk_id;
      base.effectiveShiftCode = 'PN';
      base.effectiveStart = pn.window.start; base.effectiveEnd = pn.window.end;
      base.remarks = 'Post-night duty following yesterday\'s Night shift.';
      return base;
    }
    if (pn.mode === 'REST_DAY') {
      base.postNightRestDay = true;
    }
  }

  base.effectiveDeskId = staff.desk_id;
  base.effectiveShiftCode = base.scheduledShiftCode;
  base.effectiveStart = permanent.start;
  base.effectiveEnd = permanent.end;
  base.changeType = 'NONE';
  base.remarks = base.postNightRestDay ? 'Weekly off following Night duty.' : '';
  return base;
}

function computeStatus(row, dateStr, nowMin) {
  let code;
  if (row.changeType === 'ON_LEAVE') code = 'ON_LEAVE';
  else if (row.changeType === 'DAY_OFF') code = 'DAY_OFF';
  else if (row.changeType === 'LATE_ARRIVAL') code = 'LATE';
  else if (row.changeType === 'EARLY_EXIT') code = 'EARLY_EXIT';
  else if (row.changeType === 'SHIFT_CHANGE') code = 'SHIFT_CHANGED';
  else if (row.changeType === 'DESK_CHANGE') code = 'DESK_CHANGED';
  else if (row.changeType === 'REPLACEMENT') code = 'REPLACED';
  else if (row.changeType === 'SWAP') code = 'SWAPPED';
  else if (row.changeType === 'ADDITIONAL_DUTY') code = 'ADDITIONAL_DUTY';
  else if (row.changeType === 'POST_NIGHT') code = 'POST_NIGHT';
  else if (!row.effectiveShiftCode) code = 'OFF_DUTY';
  else if (dateStr < todayStr()) code = 'COMPLETED';
  else if (dateStr > todayStr()) code = 'UPCOMING';
  else code = timeBasedStatus(row, nowMin);

  const badge = STATUS_BADGES[code] || STATUS_BADGES.UPCOMING;
  return { code: code, label: badge.label, badge: badge };
}

function timeBasedStatus(row, nowMin) {
  if (nowMin === null || !row.effectiveStart || !row.effectiveEnd) return 'UPCOMING';
  const start = parseTimeToMinutes(row.effectiveStart);
  const end = parseTimeToMinutes(row.effectiveEnd);
  const crossesMidnight = end <= start;
  if (!crossesMidnight) {
    if (nowMin < start) return 'UPCOMING';
    if (nowMin >= start && nowMin < end) return 'ON_DUTY';
    return 'COMPLETED';
  } else {
    if (nowMin >= start || nowMin < end) return 'ON_DUTY';
    if (nowMin < start) return 'UPCOMING';
    return 'COMPLETED';
  }
}

function detectConflicts(dateStr, scheduleRows) {
  const conflicts = [];
  const exToday = getActiveExceptionsForDate(dateStr);
  const repByStaff = {};
  exToday.filter(e => e.type === 'REPLACEMENT').forEach(r => {
    repByStaff[r.staff_id] = (repByStaff[r.staff_id] || 0) + 1;
  });
  Object.keys(repByStaff).forEach(staffId => {
    if (repByStaff[staffId] > 1) {
      const s = getStaffById(staffId);
      conflicts.push({ type: 'REPLACEMENT_DOUBLE_BOOKED', detail: (s ? s.display_name : staffId) + ' is assigned as replacement more than once.' });
    }
  });

  scheduleRows.forEach(row => {
    const leave = getActiveLeaveForStaffDate(row.staffId, dateStr);
    const dayOff = getActiveDayOffForStaffDate(row.staffId, dateStr);
    if ((leave || dayOff) && row.exceptionId) {
      conflicts.push({ type: 'EXCEPTION_DURING_LEAVE', detail: row.name + ' has active leave/day-off AND an active exception.' });
    }
    if (row.warning) {
      conflicts.push({ type: 'RESOLUTION_WARNING', detail: row.name + ': ' + row.warning });
    }
  });

  if (isBlank(getConfig('NIGHT_CYCLE_ANCHOR_DATE'))) {
    conflicts.push({ type: 'NIGHT_CYCLE_NOT_CONFIGURED', detail: 'NIGHT_CYCLE_ANCHOR_DATE is not configured in Settings.' });
  }

  return conflicts;
}

function getEffectiveSchedule(dateStr) {
  const activeStaff = DB.staff.filter(s => toBool(s.active));
  const schedule = activeStaff.map(s => getEffectiveDutyForStaff(s.staff_id, dateStr));
  const nowMin = (dateStr === todayStr()) ? nowMinutesOfDay() : null;
  schedule.forEach(row => {
    const st = computeStatus(row, dateStr, nowMin);
    row.status = st.code;
    row.statusLabel = st.label;
    row.badge = st.badge;
  });
  const conflicts = detectConflicts(dateStr, schedule);
  return { date: dateStr, rows: schedule, conflicts: conflicts };
}

// ==============================================================================
// 3. DATA LOADING & REALTIME SUBSCRIPTION
// ==============================================================================

async function loadAllData() {
  const startTime = performance.now();

  const [
    { data: desks, error: errDesks },
    { data: shifts, error: errShifts },
    { data: staff, error: errStaff },
    { data: roster, error: errRoster },
    { data: leaves, error: errLeaves },
    { data: dayOffs, error: errDayOffs },
    { data: exceptions, error: errExceptions },
    { data: auditLogs, error: errAudit },
    { data: configRows, error: errConfig },
    { data: nameMappings, error: errMap },
    { data: warnings, error: errWarn }
  ] = await Promise.all([
    dbClient.from('desk_master').select('*'),
    dbClient.from('shift_master').select('*'),
    dbClient.from('staff_master').select('*'),
    dbClient.from('permanent_roster').select('*'),
    dbClient.from('leaves').select('*'),
    dbClient.from('day_offs').select('*'),
    dbClient.from('exceptions').select('*'),
    dbClient.from('audit_logs').select('*').order('timestamp', { ascending: false }).limit(200),
    dbClient.from('system_config').select('*'),
    dbClient.from('name_mappings').select('*'),
    dbClient.from('data_quality_warnings').select('*')
  ]);

  if (errStaff || errRoster) {
    console.error("Supabase load error:", errStaff || errRoster);
    throw new Error((errStaff || errRoster).message);
  }

  DB.desks = desks || [];
  DB.shifts = shifts || [];
  DB.staff = staff || [];
  DB.roster = roster || [];
  DB.leaves = leaves || [];
  DB.dayOffs = dayOffs || [];
  DB.exceptions = exceptions || [];
  DB.auditLogs = auditLogs || [];
  DB.nameMappings = nameMappings || [];
  DB.warnings = warnings || [];

  DB.config = {};
  (configRows || []).forEach(c => { DB.config[c.key] = c.value; });

  const loadDuration = Math.round(performance.now() - startTime);
  console.log(`Data loaded in ${loadDuration}ms`);
}

function initRealtime() {
  const tables = ['leaves', 'day_offs', 'exceptions', 'staff_master', 'system_config'];
  const channel = dbClient.channel('realtime-all');

  tables.forEach(t => {
    channel.on('postgres_changes', { event: '*', schema: 'public', table: t }, async (payload) => {
      console.log(`Live DB change in ${t}:`, payload);
      await loadAllData();
      renderCurrentView();
      toast(`Live update: ${t.toUpperCase()} updated.`, false);
    });
  });

  channel.subscribe((status) => {
    const el = document.getElementById('liveStatus');
    if (el) {
      if (status === 'SUBSCRIBED') {
        el.innerHTML = '<span class="live-dot"></span> Live Sync';
      } else {
        el.innerHTML = 'Connecting';
      }
    }
  });
}

// ==============================================================================
// 4. UI RENDERING & ROUTING
// ==============================================================================

function badgeHtml(badge, label) {
  return `<span class="badge" style="background:${badge.color}">${badge.dot} ${esc(label)}</span>`;
}

function staffOptions(selected = '') {
  return DB.staff.filter(s => toBool(s.active)).map(s => {
    return `<option value="${s.staff_id}" ${s.staff_id === selected ? 'selected' : ''}>${esc(s.display_name)}${s.alias ? ` (${esc(s.alias)})` : ''}</option>`;
  }).join('');
}

function deskOptions(selected = '') {
  return '<option value=""> none </option>' + DB.desks.map(d => {
    return `<option value="${d.desk_id}" ${d.desk_id === selected ? 'selected' : ''}>${esc(d.display_name)}</option>`;
  }).join('');
}

function shiftOptions(selected = '') {
  return DB.shifts.map(s => {
    return `<option value="${s.shift_code}" ${s.shift_code === selected ? 'selected' : ''}>${esc(s.shift_name)} (${s.start_time}${s.end_time})</option>`;
  }).join('');
}

function bindNav() {
  document.querySelectorAll('#navlist li').forEach(li => {
    
    

    

    li.addEventListener('click', () => {
      document.querySelectorAll('#navlist li').forEach(x => x.classList.remove('active'));
      li.classList.add('active');
      const view = li.getAttribute('data-view');
      STATE.view = view;
      renderCurrentView();
    });
  });
}

function renderCurrentView() {
  const root = document.getElementById('viewRoot');
  root.innerHTML = '';
  switch (STATE.view) {
    case 'dashboard': renderDashboard(root); break;
    case 'visual': renderVisualDashboard(root); break;
    case 'schedule': renderSchedule(root); break;
    case 'changes': renderChanges(root); break;
    case 'leave': renderLeaveDayOff(root); break;
    case 'staff': renderStaffDirectory(root); break;
    case 'search': renderSearch(root); break;
    case 'audit': renderAudit(root); break;
    case 'settings': renderSettings(root); break;
    default: renderDashboard(root);
  }
}


// ---------- VISUAL TIMELINE VIEW ----------

function toggleFullScreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(err => {
      console.error('Error attempting to enable fullscreen mode:', err);
    });
  } else {
    if (document.exitFullscreen) {
      document.exitFullscreen();
    }
  }
}

document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement) {
    document.body.classList.remove('fullscreen-mode');
  } else {
    document.body.classList.add('fullscreen-mode');
  }
});


function renderVisualDashboard(root) {
  const sched = getEffectiveSchedule(STATE.date);
  let rows = sched.rows;

  if (STATE.deskFilter) rows = rows.filter(r => r.deskId === STATE.deskFilter);

  const deskOrder = ['WEB_INCHARGE', 'CENTRAL', 'SHIFT_INCHARGE', 'NATIONAL', 'INTERNATIONAL', 'SPORTS', 'RELIGION', 'LIFESTYLE', 'BUSINESS', 'REPORTER', 'ENGLISH'];
  const staffOrder = ['S001', 'S003', 'S011', 'S012', 'S007', 'S002', 'S016', 'S009', 'S005', 'S008', 'S006', 'S010', 'S013', 'S014', 'S015', 'S017', 'S020', 'S018', 'S021', 'S022', 'S023', 'S026', 'S027', 'S029', 'S030', 'S028', 'S004', 'S031'];
  
  rows.sort((a, b) => {
    if (STATE.visualSortBy === 'time') {
      const aStart = parseTimeToMinutes(a.effectiveStart || '24:00');
      const bStart = parseTimeToMinutes(b.effectiveStart || '24:00');
      if (aStart !== bStart) return aStart - bStart;
    }
    const dIdxA = deskOrder.indexOf(a.deskId) === -1 ? 999 : deskOrder.indexOf(a.deskId);
    const dIdxB = deskOrder.indexOf(b.deskId) === -1 ? 999 : deskOrder.indexOf(b.deskId);
    if (dIdxA !== dIdxB) return dIdxA - dIdxB;
    
    const sIdxA = staffOrder.indexOf(a.staffId) === -1 ? 999 : staffOrder.indexOf(a.staffId);
    const sIdxB = staffOrder.indexOf(b.staffId) === -1 ? 999 : staffOrder.indexOf(b.staffId);
    if (sIdxA !== sIdxB) return sIdxA - sIdxB;
    
    return (a.deskName || '').localeCompare(b.deskName || '') || a.name.localeCompare(b.name);
  });

  const d = parseDateStr(STATE.date);
  const dateFormatted = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'UTC' });

  const activeRows = rows.filter(r => !['OFF_DUTY', 'ON_LEAVE'].includes(r.status));

  let gridHtml = '';
  activeRows.forEach(r => {
    let startMin = parseTimeToMinutes(r.effectiveStart);
    let endMin = parseTimeToMinutes(r.effectiveEnd);
    let barHtml = '';

    if (startMin !== null && endMin !== null) {
      
      let startStr = '';
      if (r.effectiveStart) {
        const [h, m] = r.effectiveStart.split(':');
        const hr = parseInt(h);
        const ampm = hr >= 12 ? 'pm' : 'am';
        const hr12 = hr % 12 || 12;
        startStr = `${hr12}${m === '00' ? '' : ':'+m}${ampm}`;
      }

      let shortDesk = '';
      if (r.deskId === 'WEB_INCHARGE') shortDesk = 'InCh';
      else if (r.deskId === 'CENTRAL') shortDesk = 'Cent';
      else if (r.deskId === 'NATIONAL') shortDesk = 'BD';
      else if (r.deskId === 'RELIGION') shortDesk = 'Rel';
      else if (r.deskId === 'LIFESTYLE' || r.deskId === 'ENTERTAINMENT') shortDesk = 'Ent';
      else if (r.deskId === 'SPORTS') shortDesk = 'Spo';
      else if (r.deskId === 'REPORTER') shortDesk = 'Rep';
      else if (r.deskId === 'INTERNATIONAL') shortDesk = 'Int';
      else shortDesk = (r.deskId || '').substring(0,4);

      const customNames = {'S001':'Mamun', 'S003':'Jony', 'S011':'Sajib', 'S012':'Provash', 'S007':'Nazmul', 'S002':'Sadi', 'S016':'Noman', 'S009':'Karim', 'S005':'Raka', 'S008':'Shikha', 'S006':'Toton', 'S010':'Jeem', 'S013':'Shamina', 'S014':'Juwel', 'S015':'Shohag', 'S017':'Faisal', 'S020':'Mostafa', 'S018':'Zamir', 'S021':'Rahat', 'S022':'Shuvo', 'S023':'Sowat', 'S026':'Tamim', 'S027':'Jakaria', 'S029':'Suraiya', 'S030':'Bristy', 'S028':'Bijoy', 'S004':'Mehedi', 'S031':'Abir'};
      const displayName = customNames[r.staffId] || (r.alias ? r.alias.split(' ')[0] : r.name.split(' ')[0]);
      const barText = `${displayName} | ${shortDesk} | ${startStr}`;

      if (r.effectiveShiftCode === '11pm' || startMin > endMin) {
        if (startMin >= 420 && startMin <= 1380) {
          const leftPct = ((startMin - 420) / 960) * 100;
          barHtml = `<div class="duty-bar bar-night" style="left: ${leftPct}%; width: ${100 - leftPct}%; padding: 4px 8px; justify-content: center; overflow: hidden; font-weight: 500; font-size: 11.5px;" title="${r.name} | Night Shift | ${r.effectiveStart} - ${r.effectiveEnd}">
            ${r.status === 'LATE' ? '<span style="font-size:12px; margin-right:4px;">⚠️</span>' : ''}
            <span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${barText}</span>
          </div>`;
        } else if (endMin >= 420) {
          const wPct = ((endMin - 420) / 960) * 100;
          barHtml = `<div class="duty-bar bar-night" style="left: 0%; width: ${Math.max(0, wPct)}%; padding: 4px 8px; justify-content: center; overflow: hidden; font-weight: 500; font-size: 11.5px;" title="${r.name} | Night Shift | ${r.effectiveStart} - ${r.effectiveEnd}">
            ${r.status === 'LATE' ? '<span style="font-size:12px; margin-right:4px;">⚠️</span>' : ''}
            <span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${barText}</span>
          </div>`;
        }
      } else {
        let drawStart = Math.max(420, startMin);
        let drawEnd = Math.min(1380, endMin);
        if (drawStart < 1380 && drawEnd > 420) {
          const leftPct = ((drawStart - 420) / 960) * 100;
          const widthPct = ((drawEnd - drawStart) / 960) * 100;
          
          let colorClass = 'bar-other';
          if (r.deskId === 'WEB_INCHARGE') colorClass = 'bar-inch';
          else if (r.deskId === 'CENTRAL') colorClass = 'bar-central';
          else if (r.deskId === 'NATIONAL') colorClass = 'bar-bd';
          else if (r.deskId === 'INTERNATIONAL') colorClass = 'bar-global';
          else if (r.deskId === 'SPORTS') colorClass = 'bar-sports';
          else if (r.deskId === 'RELIGION') colorClass = 'bar-rel';
          else if (r.deskId === 'LIFESTYLE' || r.deskId === 'ENTERTAINMENT') colorClass = 'bar-ent';
          else if (r.deskId === 'REPORTER') colorClass = 'bar-rep';

          barHtml = `<div class="duty-bar ${colorClass}" style="left: ${leftPct}%; width: ${widthPct}%; padding: 4px 8px; justify-content: center; overflow: hidden; font-weight: 500; font-size: 11.5px; z-index: 10;" title="${r.name} | ${r.deskName} | ${r.effectiveStart} - ${r.effectiveEnd}">
            ${r.status === 'LATE' ? '<span style="font-size:12px; margin-right:4px;">⚠️</span>' : ''}
            <span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${barText}</span>
          </div>`;
        }
      }
    }

    gridHtml += `
      <div class="gantt-row">
        <div class="gantt-cell" style="grid-column: 1 / span 16;">
          ${barHtml}
        </div>
      </div>
    `;
  });

  root.innerHTML = `
        <div class="topbar" style="align-items: center; margin-bottom: 0;">
      <div class="datebox" style="margin: 0;">
        <div class="today-lbl" style="font-size: 18px;">${dateFormatted} <span class="day-lbl" style="font-size: 12px; font-weight: normal; margin-left: 8px;">Timeline (7AM - 11PM)</span></div>
      </div>
      <div style="display:flex;gap:8px;align-items:center;">
        <button class="btn btn-outline" id="btnVisPrev" style="padding:4px 8px;">◀</button>
        <input type="date" id="visDatePicker" class="input" value="${STATE.date}" style="width:130px; padding:4px;">
        <button class="btn btn-outline" id="btnVisNext" style="padding:4px 8px;">▶</button>
        
        <div style="width:1px; height:20px; background:#cbd5e1; margin:0 2px;"></div>
        
        <select class="input" id="visFilterDesk" style="width:120px; padding:4px;">
          <option value="">All Desks</option>
          ${DB.desks.filter(d=>d.status==='ACTIVE').map(d => `<option value="${d.desk_id}" ${STATE.deskFilter === d.desk_id ? 'selected' : ''}>${esc(d.display_name)}</option>`).join('')}
        </select>
        
        <div style="width:1px; height:20px; background:#cbd5e1; margin:0 2px;"></div>

        <button class="btn ${STATE.visualSortBy === 'time' ? 'btn-primary' : 'btn-outline'}" id="btnSortTime" style="padding:4px 8px;">Sort: Time</button>
        <button class="btn ${STATE.visualSortBy !== 'time' ? 'btn-primary' : 'btn-outline'}" id="btnSortDesk" style="padding:4px 8px;">Sort: Desk</button>
        
        <button class="btn btn-outline" onclick="toggleFullScreen()" style="background:#1e293b; color:white; border-color:#1e293b; padding:4px 8px; margin-left:4px;">⛶ Full Screen</button>
      </div>
    </div>

        
    <div style="padding: 20px; overflow-x: auto; background: white; border-radius: 8px; margin: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
      <div class="gantt-container" style="position: relative; min-width: 900px;">
        <div id="currentTimeLine" style="position: absolute; top: 0; bottom: 0; width: 2px; background: red; z-index: 20; display: none; box-shadow: 0 0 4px rgba(255,0,0,0.5);"></div>
        <div class="gantt-grid">
          <div class="gantt-header">
            <div class="gantt-cell gantt-time-header">7 AM</div>
            <div class="gantt-cell gantt-time-header">8 AM</div>
            <div class="gantt-cell gantt-time-header">9 AM</div>
            <div class="gantt-cell gantt-time-header">10 AM</div>
            <div class="gantt-cell gantt-time-header">11 AM</div>
            <div class="gantt-cell gantt-time-header">12 PM</div>
            <div class="gantt-cell gantt-time-header">1 PM</div>
            <div class="gantt-cell gantt-time-header">2 PM</div>
            <div class="gantt-cell gantt-time-header">3 PM</div>
            <div class="gantt-cell gantt-time-header">4 PM</div>
            <div class="gantt-cell gantt-time-header">5 PM</div>
            <div class="gantt-cell gantt-time-header">6 PM</div>
            <div class="gantt-cell gantt-time-header">7 PM</div>
            <div class="gantt-cell gantt-time-header">8 PM</div>
            <div class="gantt-cell gantt-time-header">9 PM</div>
            <div class="gantt-cell gantt-time-header">10 PM</div>
          </div>
          ${gridHtml}
        </div>
      </div>
    </div>
  `;

  document.getElementById('btnSortTime').onclick = () => { STATE.visualSortBy = 'time'; renderCurrentView(); };
  document.getElementById('btnSortDesk').onclick = () => { STATE.visualSortBy = 'desk'; renderCurrentView(); };
  document.getElementById('visFilterDesk').onchange = (e) => { STATE.deskFilter = e.target.value; renderCurrentView(); };
  document.getElementById('visDatePicker').onchange = (e) => { STATE.date = e.target.value; renderCurrentView(); };
  document.getElementById('btnVisPrev').onclick = () => { STATE.date = addDaysToStr(STATE.date, -1); renderCurrentView(); };
  document.getElementById('btnVisNext').onclick = () => { STATE.date = addDaysToStr(STATE.date, 1); renderCurrentView(); };
  document.getElementById('btnSortDesk').onclick = () => { STATE.visualSortBy = 'desk'; renderCurrentView(); };
  document.getElementById('visFilterDesk').onchange = (e) => { STATE.deskFilter = e.target.value; renderCurrentView(); };
  document.getElementById('visDatePicker').onchange = (e) => { STATE.date = e.target.value; renderCurrentView(); };

  const dObj = new Date();
  const dateStr = dObj.getFullYear() + '-' + String(dObj.getMonth() + 1).padStart(2, '0') + '-' + String(dObj.getDate()).padStart(2, '0');
  
  if (STATE.date === dateStr) {
    const currentMins = dObj.getHours() * 60 + dObj.getMinutes();
    if (currentMins >= 420 && currentMins <= 1380) {
      const line = document.getElementById('currentTimeLine');
      const leftPct = ((currentMins - 420) / 960) * 100;
      line.style.display = 'block';
      line.style.left = `calc(${leftPct}%)`;
    }
  }
}


// ---------- DASHBOARD VIEW ----------
function renderDashboard(root) {
  const sched = getEffectiveSchedule(STATE.date);
  const rows = sched.rows;

  let counts = { total: rows.length, onDuty: 0, upcoming: 0, completed: 0, onLeave: 0, dayOff: 0, changes: 0, late: 0, conflicts: sched.conflicts.length };
  rows.forEach(r => {
    if (r.status === 'ON_DUTY') counts.onDuty++;
    if (r.status === 'UPCOMING') counts.upcoming++;
    if (r.status === 'COMPLETED') counts.completed++;
      if (r.status === 'ON_LEAVE') counts.onLeave++;
      if (r.status === 'OFF_DUTY') counts.dayOff++;
      if (r.status === 'LATE') counts.late++;
    if (r.changeType !== 'NONE') counts.changes++;
  });

  let filteredRows = rows;
  if (STATE.deskFilter) filteredRows = filteredRows.filter(r => r.deskId === STATE.deskFilter);
  if (STATE.statusFilter) filteredRows = filteredRows.filter(r => r.status === STATE.statusFilter);
  const deskOrder = ['WEB_INCHARGE', 'CENTRAL', 'SHIFT_INCHARGE', 'NATIONAL', 'INTERNATIONAL', 'SPORTS', 'RELIGION', 'LIFESTYLE', 'BUSINESS', 'REPORTER', 'ENGLISH'];
  const staffOrder = ['S001', 'S003', 'S011', 'S012', 'S007', 'S002', 'S016', 'S009', 'S005', 'S008', 'S006', 'S010', 'S013', 'S014', 'S015', 'S017', 'S020', 'S018', 'S021', 'S022', 'S023', 'S026', 'S027', 'S029', 'S030', 'S028', 'S004', 'S031'];
  
  filteredRows.sort((a, b) => {
    const dIdxA = deskOrder.indexOf(a.deskId) === -1 ? 999 : deskOrder.indexOf(a.deskId);
    const dIdxB = deskOrder.indexOf(b.deskId) === -1 ? 999 : deskOrder.indexOf(b.deskId);
    if (dIdxA !== dIdxB) return dIdxA - dIdxB;
    
    const sIdxA = staffOrder.indexOf(a.staffId) === -1 ? 999 : staffOrder.indexOf(a.staffId);
    const sIdxB = staffOrder.indexOf(b.staffId) === -1 ? 999 : staffOrder.indexOf(b.staffId);
    if (sIdxA !== sIdxB) return sIdxA - sIdxB;
    
    return (a.deskName || '').localeCompare(b.deskName || '') || a.name.localeCompare(b.name);
  });

  const d = parseDateStr(STATE.date);
  const dateFormatted = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'UTC' });
  const dayFormatted = d.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });

  root.innerHTML = `
    <div class="topbar">
      <div class="datebox">
        <div class="today-lbl">${dateFormatted}</div>
        <div class="day-lbl">${dayFormatted}</div>
      </div>
      <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
        <button class="btn" id="prevDayBtn">&larr; Previous</button>
        <button class="btn primary" id="todayBtn">TODAY</button>
        <button class="btn" id="nextDayBtn">Next &rarr;</button>
        <input type="date" id="datePicker" value="${STATE.date}" style="width:140px;">
        <button class="btn" id="refreshBtn"> Refresh</button>
      </div>
    </div>

    <div class="cards">
      <div class="card"><div class="num">${counts.total}</div><div class="lbl">Total Staff</div></div>
      <div class="card"><div class="num">${counts.onDuty}</div><div class="lbl">On Duty</div></div>
      <div class="card"><div class="num">${counts.upcoming}</div><div class="lbl">Upcoming</div></div>
      <div class="card"><div class="num">${counts.completed}</div><div class="lbl">Completed</div></div>
      <div class="card"><div class="num">${counts.onLeave}</div><div class="lbl">On Leave</div></div>
      <div class="card"><div class="num">${counts.dayOff}</div><div class="lbl">Weekly Off</div></div>
      <div class="card"><div class="num">${counts.changes}</div><div class="lbl">Changes</div></div>
      <div class="card"><div class="num">${counts.late}</div><div class="lbl">Late</div></div>
      <div class="card ${counts.conflicts ? 'conflict' : ''}"><div class="num">${counts.conflicts}</div><div class="lbl">Conflicts</div></div>
    </div>

    ${sched.conflicts.length ? `
      <div class="conflict-box">
         <strong>${sched.conflicts.length} CONFLICT${sched.conflicts.length > 1 ? 'S' : ''} DETECTED:</strong>
        ${sched.conflicts.map(c => esc(c.detail)).join(' | ')}
      </div>
    ` : ''}

    <div class="section-title">
      <span>Today's Live Duty Board</span>
      <div class="filters" style="margin:0;">
        <select id="filterDesk">
          <option value="">All Desks</option>
          ${DB.desks.map(dk => `<option value="${dk.desk_id}" ${dk.desk_id === STATE.deskFilter ? 'selected' : ''}>${esc(dk.display_name)}</option>`).join('')}
        </select>
        <select id="filterStatus">
          <option value="">All Statuses</option>
          ${['UPCOMING','ON_DUTY','COMPLETED','ON_LEAVE','DAY_OFF','LATE','EARLY_EXIT','SHIFT_CHANGED','DESK_CHANGED','REPLACED','SWAPPED','ADDITIONAL_DUTY','POST_NIGHT','OFF_DUTY'].map(st => `
            <option value="${st}" ${st === STATE.statusFilter ? 'selected' : ''}>${st.replace(/_/g, ' ')}</option>
          `).join('')}
        </select>
      </div>
    </div>

    <div class="table-container">
      <table class="datatable">
        <thead>
          <tr>
            <th>Desk</th>
            <th>Employee</th>
            <th>Role</th>
            <th>Shift</th>
            <th>Scheduled</th>
            <th>Actual/Revised</th>
            <th>Status</th>
            <th>Change</th>
            <th>Remarks</th>
          </tr>
        </thead>
        <tbody>
          ${filteredRows.length ? filteredRows.map(r => `
            <tr>
              <td>${esc(r.deskName)}</td>
              <td class="clickable" data-staff="${r.staffId}">
                ${esc(r.name)} ${r.alias ? `<span class="muted">(${esc(r.alias)})</span>` : ''}
              </td>
              <td>${esc(r.role)}</td>
              <td>${esc(r.scheduledShiftCode || 'OFF')}</td>
              <td>${r.scheduledStart ? `${r.scheduledStart}${r.scheduledEnd}` : ''}</td>
              <td>${r.effectiveStart ? `${r.effectiveStart}${r.effectiveEnd}` : ''}</td>
              <td>${badgeHtml(r.badge, r.statusLabel)}</td>
              <td>${r.changeType !== 'NONE' ? esc(r.changeType.replace(/_/g, ' ')) : ''}</td>
              <td>${esc(r.remarks || (r.coveredBy ? 'Covered by ' + r.coveredBy : ''))}</td>
            </tr>
          `).join('') : '<tr><td colspan="9" class="empty">No staff match the selected filters.</td></tr>'}
        </tbody>
      </table>
    </div>
  `;

  document.getElementById('prevDayBtn').onclick = () => { STATE.date = addDaysToStr(STATE.date, -1); renderDashboard(root); };
  document.getElementById('nextDayBtn').onclick = () => { STATE.date = addDaysToStr(STATE.date, 1); renderDashboard(root); };
  document.getElementById('todayBtn').onclick = () => { STATE.date = todayStr(); renderDashboard(root); };
  document.getElementById('datePicker').onchange = (e) => { STATE.date = e.target.value; renderDashboard(root); };
  document.getElementById('refreshBtn').onclick = async () => { await loadAllData(); renderDashboard(root); toast('Dashboard refreshed'); };

  document.getElementById('filterDesk').onchange = (e) => { STATE.deskFilter = e.target.value; renderDashboard(root); };
  document.getElementById('filterStatus').onchange = (e) => { STATE.statusFilter = e.target.value; renderDashboard(root); };

  
  const btnAdd = root.querySelector('#btnAddStaff');
  if (btnAdd) {
    btnAdd.addEventListener('click', () => {
      editStaff(null);
    });
  }

  root.querySelectorAll('[data-staff]').forEach(el => {
    el.addEventListener('click', () => showStaffModal(el.getAttribute('data-staff')));
  });
}

function showStaffModal(staffId) {
  const staff = getStaffById(staffId);
  if (!staff) return;
  const desk = getDeskById(staff.desk_id);
  const todayDuty = getEffectiveDutyForStaff(staffId, STATE.date);
  const tomorrowDuty = getEffectiveDutyForStaff(staffId, addDaysToStr(STATE.date, 1));
  const todaySt = computeStatus(todayDuty, STATE.date, STATE.date === todayStr() ? nowMinutesOfDay() : null);
  const tomorrowSt = computeStatus(tomorrowDuty, addDaysToStr(STATE.date, 1), null);
  const upcomingLeaves = DB.leaves.filter(l => l.staff_id === staffId && l.status === 'ACTIVE' && l.to_date >= STATE.date);
  const recentChanges = DB.auditLogs.filter(a => a.staff_id === staffId).slice(0, 5);

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-box">
      <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:12px;">
        <div>
          <div style="font-size:18px;font-weight:700;color:var(--navy);">${esc(staff.display_name)} ${staff.alias ? `(${esc(staff.alias)})` : ''}</div>
          <div class="muted">${esc(desk ? desk.display_name : staff.desk_id)}  ${esc(staff.role)} ${toBool(staff.in_charge) ? ' In-Charge' : ''}</div>
          <div style="margin-top:4px; font-weight:500; color:#3b82f6;">Mobile: ${staff.notes ? esc(staff.notes) : 'No mobile number'}</div>
        </div>
        <button class="btn small" id="closeModal"></button>
      </div>

      <div class="section-title">Selected Date (${fmtDateDisplay(STATE.date)})</div>
      <div>
        ${badgeHtml(todaySt.badge, todaySt.label)}  ${todayDuty.effectiveStart ? `${todayDuty.effectiveStart}${todayDuty.effectiveEnd}` : 'No duty'}
        ${todayDuty.remarks ? `<br><span class="muted">${esc(todayDuty.remarks)}</span>` : ''}
      </div>

      <div class="section-title">Tomorrow (${fmtDateDisplay(addDaysToStr(STATE.date, 1))})</div>
      <div>
        ${badgeHtml(tomorrowSt.badge, tomorrowSt.label)}  ${tomorrowDuty.effectiveStart ? `${tomorrowDuty.effectiveStart}${tomorrowDuty.effectiveEnd}` : 'No duty'}
      </div>

      <div class="section-title">Night Cycle Pattern (This Week)</div>
      <div>${getNightPatternForDate(STATE.date) || '<span class="muted">Not configured</span>'}</div>

      ${upcomingLeaves.length ? `
        <div class="section-title">Upcoming / Active Leave</div>
        ${upcomingLeaves.map(l => `<div> ${l.from_date}  ${l.to_date} (${esc(l.leave_type)})</div>`).join('')}
      ` : ''}

      <div class="section-title">Recent History</div>
      <div>
        ${recentChanges.length ? recentChanges.map(c => `<div class="muted" style="margin-bottom:3px;">${c.timestamp || ''}: ${esc(c.action)}</div>`).join('') : '<div class="muted">No recent changes.</div>'}
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
  overlay.querySelector('#closeModal').onclick = () => overlay.remove();
}

// ---------- PERMANENT SCHEDULE VIEW ----------

async function updatePermanentRoster(staffId, weekday, newShiftCode) {
  const shiftType = newShiftCode === 'OFF' ? 'OFF' : (newShiftCode === '11pm' ? 'Night' : 'Day');
  const shiftCode = newShiftCode === 'OFF' ? '' : newShiftCode;
  
  const payload = {
    staff_id: staffId,
    weekday: weekday,
    shift_type: shiftType,
    shift_code: shiftCode
  };

  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/permanent_roster`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates'
      },
      body: JSON.stringify(payload)
    });

    if (!res.ok) throw new Error(await res.text());
    
    // Update local DB cache
    let existing = DB.roster.find(r => r.staff_id === staffId && r.weekday === weekday);
    if (existing) {
      existing.shift_type = shiftType;
      existing.shift_code = shiftCode;
    } else {
      DB.roster.push(payload);
    }
    
    // Show quick toast/alert
    const toast = document.createElement('div');
    toast.textContent = 'Saved!';
    toast.style.cssText = 'position:fixed; bottom:20px; right:20px; background:#10b981; color:white; padding:8px 16px; border-radius:4px; z-index:9999;';
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2000);
    
  } catch (err) {
    alert('Error saving roster: ' + err.message);
  }
}


function renderSchedule(root) {
  const weekStart = weekStartStr(STATE.date);
  const days = [0,1,2,3,4,5,6].map(i => {
    const dStr = addDaysToStr(weekStart, i);
    return { date: dStr, weekday: WEEKDAY_NAMES[i] };
  });

  const activeStaff = DB.staff.filter(s => toBool(s.active));

  root.innerHTML = `
    <div class="topbar">
      <div class="section-title" style="margin:0;">Permanent Weekly Roster</div>
      <div style="display:flex;align-items:center;gap:8px;">
        <label style="margin:0;">Week Starting:</label>
        <input type="date" id="weekPicker" value="${weekStart}" style="width:140px;">
      </div>
    </div>

    <div class="weekgrid">
      <div class="cell hdr" style="text-align:left;padding-left:12px;">Employee</div>
      ${days.map(d => `
        <div class="cell hdr">
          ${d.weekday.slice(0, 3)}<br>
          <span style="font-weight:400;font-size:10px;">${d.date.slice(5)}</span>
        </div>
      `).join('')}

      ${activeStaff.map(s => {
        const desk = getDeskById(s.desk_id);
                const dayCells = days.map(d => {
            const r = DB.roster.find(ro => ro.staff_id === s.staff_id && ro.weekday === d.weekday);
            let currentVal = r ? (r.shift_type === 'OFF' ? 'OFF' : r.shift_code) : '';
            if (!currentVal && r && r.shift_type === 'Night') currentVal = '11pm';
            
            let cls = currentVal === 'OFF' ? 'off' : (currentVal === '11pm' ? 'night' : '');
            
            let optionsHtml = `<option value="OFF" ${currentVal === 'OFF' ? 'selected' : ''}>OFF</option>`;
            DB.shifts.forEach(shift => {
              optionsHtml += `<option value="${shift.shift_code}" ${currentVal === shift.shift_code ? 'selected' : ''}>${shift.shift_code}</option>`;
            });
            
            return `<div class="cell ${cls}" style="padding:0;">
              <select class="inline-select" ${window.currentUserRole !== 'admin' ? 'disabled' : ''} ${window.currentUserRole !== 'admin' ? 'disabled' : ''} ${window.currentUserRole !== 'admin' ? 'disabled' : ''} onchange="updatePermanentRoster('${s.staff_id}', '${d.weekday}', this.value); this.parentElement.className = 'cell ' + (this.value === 'OFF' ? 'off' : (this.value === '11pm' ? 'night' : ''));">
                ${optionsHtml}
              </select>
            </div>`;
          }).join('');

        return `
          <div class="cell staffcell">
            ${esc(s.display_name)}<br>
            <span class="muted" style="font-weight:400;font-size:10px;">${esc(desk ? desk.display_name : s.desk_id)}</span>
          </div>
          ${dayCells}
        `;
      }).join('')}
    </div>
  `;

  document.getElementById('weekPicker').onchange = (e) => {
    STATE.date = e.target.value;
    renderSchedule(root);
  };
}

// ---------- CHANGES & EXCEPTIONS VIEW ----------
function renderChanges(root) {
  root.innerHTML = `
    <div class="topbar">
      <div class="section-title" style="margin:0;">Changes &amp; Exceptions</div>
      <div style="display:flex;gap:8px;">
        <select id="addExType" style="width:160px;">
          <option value="SHIFT_CHANGE">Shift Change</option>
          <option value="DESK_CHANGE">Desk Change</option>
          <option value="LATE_ARRIVAL">Late Arrival</option>
          <option value="EARLY_EXIT">Early Exit</option>
          <option value="SWAP">Duty Swap</option>
          <option value="REPLACEMENT">Replacement</option>
          <option value="ADDITIONAL_DUTY">Additional Duty</option>
        </select>
        <button class="btn primary" id="addExBtn">+ Add Exception</button>
      </div>
    </div>
    <div id="exFormHost"></div>
    <div class="filters">
      <select id="exTypeFilter">
        <option value="">All Types</option>
        ${['SHIFT_CHANGE','DESK_CHANGE','LATE_ARRIVAL','EARLY_EXIT','SWAP','REPLACEMENT','ADDITIONAL_DUTY'].map(t => `<option value="${t}">${t.replace(/_/g, ' ')}</option>`).join('')}
      </select>
    </div>
    <div id="exListHost"></div>
  `;

  document.getElementById('addExBtn').onclick = () => {
    const type = document.getElementById('addExType').value;
    const host = document.getElementById('exFormHost');
    host.innerHTML = '';
    host.appendChild(renderExceptionForm(type, () => { host.innerHTML = ''; loadExceptionsList(); }));
  };

  document.getElementById('exTypeFilter').onchange = loadExceptionsList;
  loadExceptionsList();
}

function loadExceptionsList() {
  const typeFilter = document.getElementById('exTypeFilter').value;
  let rows = DB.exceptions.filter(e => e.status === 'ACTIVE');
  if (typeFilter) rows = rows.filter(e => e.type === typeFilter);
  rows.sort((a, b) => b.date.localeCompare(a.date));

  const host = document.getElementById('exListHost');
  host.innerHTML = `
    <div class="table-container">
      <table class="datatable">
        <thead>
          <tr>
            <th>Type</th>
            <th>Date</th>
            <th>Staff</th>
            <th>Related Staff</th>
            <th>Shift</th>
            <th>Time</th>
            <th>Reason</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          ${rows.length ? rows.map(r => {
            const s = getStaffById(r.staff_id);
            const rs = getStaffById(r.related_staff_id);
            return `
              <tr>
                <td><strong>${r.type.replace(/_/g, ' ')}</strong></td>
                <td>${r.date}</td>
                <td>${esc(s ? s.display_name : r.staff_id)}</td>
                <td>${esc(rs ? rs.display_name : r.related_staff_id || '')}</td>
                <td>${esc(r.new_shift_code || '')}</td>
                <td>${r.new_start ? `${r.new_start}${r.new_end}` : ''}</td>
                <td>${esc(r.reason)}</td>
                <td><button class="btn small danger" data-cancel-ex="${r.exception_id}">Cancel</button></td>
              </tr>
            `;
          }).join('') : '<tr><td colspan="8" class="empty">No active exceptions found.</td></tr>'}
        </tbody>
      </table>
    </div>
  `;

  host.querySelectorAll('[data-cancel-ex]').forEach(b => {
    b.onclick = async () => {
      const eid = b.getAttribute('data-cancel-ex');
      if (confirm('Cancel this exception?')) {
        await dbClient.from('exceptions').update({ status: 'CANCELLED' }).eq('exception_id', eid);
        await dbClient.from('audit_logs').insert([{
          log_id: 'LOG-' + Date.now(),
          timestamp: new Date().toISOString().replace('T', ' ').slice(0, 16),
          user_email: 'Web User',
          action: 'EXCEPTION_CANCELLED',
          notes: eid
        }]);
        await loadAllData();
        loadExceptionsList();
        toast('Exception cancelled');
      }
    };
  });
}

function renderExceptionForm(type, onDone) {
  const box = document.createElement('div');
  box.className = 'panel';
  const needsRelated = (type === 'SWAP' || type === 'REPLACEMENT');
  const needsShift = (type === 'SHIFT_CHANGE' || type === 'ADDITIONAL_DUTY');
  const needsDesk = (type === 'DESK_CHANGE' || type === 'ADDITIONAL_DUTY');
  const needsTimes = (type === 'LATE_ARRIVAL' || type === 'EARLY_EXIT' || type === 'ADDITIONAL_DUTY');

  box.innerHTML = `
    <div style="font-weight:700;margin-bottom:10px;font-size:14px;color:var(--navy);">New ${type.replace(/_/g, ' ')}</div>
    <div class="row">
      <div><label>Date</label><input type="date" id="f_date" value="${STATE.date}"></div>
      <div><label>Employee</label><select id="f_staff">${staffOptions()}</select></div>
      ${needsRelated ? `<div><label>${type === 'REPLACEMENT' ? 'Replacing (Absent Employee)' : 'Swap With'}</label><select id="f_related">${staffOptions()}</select></div>` : ''}
    </div>
    ${needsShift ? `<div class="row"><div><label>New Shift</label><select id="f_shift">${shiftOptions()}</select></div></div>` : ''}
    ${needsDesk ? `<div class="row"><div><label>New Desk</label><select id="f_desk">${deskOptions()}</select></div></div>` : ''}
    ${needsTimes ? `
      <div class="row">
        <div><label>Start Time</label><input type="time" id="f_start"></div>
        <div><label>End Time</label><input type="time" id="f_end"></div>
      </div>
    ` : ''}
    <div class="row">
      <div><label>Reason</label><input id="f_reason" placeholder="Reason for change"></div>
      <div><label>Approved By</label><input id="f_approved" placeholder="Supervisor Name"></div>
    </div>
    <div style="margin-top:14px;display:flex;gap:8px;">
      <button class="btn primary" id="f_submit">Save Exception</button>
      <button class="btn" id="f_cancel">Cancel</button>
    </div>
  `;

  box.querySelector('#f_cancel').onclick = () => box.remove();
  box.querySelector('#f_submit').onclick = async () => {
    const sid = box.querySelector('#f_staff').value;
    const relId = needsRelated ? box.querySelector('#f_related').value : '';
    if (needsRelated && (!relId || relId === sid)) {
      alert('Please select two different employees.');
      return;
    }
    const newEx = {
      exception_id: 'EX-' + String(Date.now()).slice(-5),
      type: type,
      date: box.querySelector('#f_date').value,
      staff_id: sid,
      related_staff_id: relId,
      new_shift_code: needsShift ? box.querySelector('#f_shift').value : '',
      new_desk_id: needsDesk ? box.querySelector('#f_desk').value : '',
      new_start: needsTimes ? box.querySelector('#f_start').value : '',
      new_end: needsTimes ? box.querySelector('#f_end').value : '',
      reason: box.querySelector('#f_reason').value,
      approved_by: box.querySelector('#f_approved').value,
      status: 'ACTIVE',
      created_at: new Date().toISOString().replace('T', ' ').slice(0, 16)
    };

    const { error } = await dbClient.from('exceptions').insert([newEx]);
    if (error) {
      alert('Error saving exception: ' + error.message);
      return;
    }
    await dbClient.from('audit_logs').insert([{
      log_id: 'LOG-' + Date.now(),
      timestamp: new Date().toISOString().replace('T', ' ').slice(0, 16),
      user_email: 'Web User',
      action: 'EXCEPTION_ADDED',
      staff_id: sid,
      date: newEx.date,
      reason: newEx.reason
    }]);

    await loadAllData();
    toast('Exception saved');
    if (onDone) onDone();
  };
  return box;
}

// ---------- LEAVE / DAY OFF VIEW ----------
function renderLeaveDayOff(root) {
  root.innerHTML = `
    <div class="tabbar">
      <div class="tab active" data-t="leave">Leave Records</div>
      <div class="tab" data-t="dayoff">Day Off Records</div>
    </div>
    <div id="ldPanel"></div>
  `;

  root.querySelectorAll('.tab').forEach(t => {
    t.onclick = () => {
      root.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
      t.classList.add('active');
      showLdTab(t.getAttribute('data-t'));
    };
  });

  showLdTab('leave');
}

function showLdTab(which) {
  const panel = document.getElementById('ldPanel');
  panel.innerHTML = `
    <div class="topbar">
      <div class="section-title" style="margin:0;">Active ${which === 'leave' ? 'Leaves' : 'Day Offs'}</div>
      <button class="btn primary" id="addLdBtn">+ Add ${which === 'leave' ? 'Leave' : 'Day Off'}</button>
    </div>
    <div id="ldFormHost"></div>
    <div id="ldListHost"></div>
  `;

  document.getElementById('addLdBtn').onclick = () => {
    const host = document.getElementById('ldFormHost');
    host.innerHTML = '';
    host.appendChild(which === 'leave' ? renderLeaveForm(() => { host.innerHTML = ''; loadLdList(which); }) : renderDayOffForm(() => { host.innerHTML = ''; loadLdList(which); }));
  };

  loadLdList(which);
}

function loadLdList(which) {
  const host = document.getElementById('ldListHost');
  if (which === 'leave') {
    const rows = DB.leaves.filter(l => l.status === 'ACTIVE').sort((a, b) => b.from_date.localeCompare(a.from_date));
    host.innerHTML = `
      <div class="table-container">
        <table class="datatable">
          <thead>
            <tr>
              <th>Employee</th>
              <th>Type</th>
              <th>Date Range</th>
              <th>Replacement</th>
              <th>Reason</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            ${rows.length ? rows.map(r => {
              const s = getStaffById(r.staff_id);
              const rep = getStaffById(r.replacement_staff_id);
              return `
                <tr>
                  <td><strong>${esc(s ? s.display_name : r.staff_id)}</strong></td>
                  <td>${esc(r.leave_type)}</td>
                  <td>${r.from_date}  ${r.to_date}</td>
                  <td>${esc(rep ? rep.display_name : (r.replacement_staff_id || ''))}</td>
                  <td>${esc(r.reason)}</td>
                  <td><button class="btn small danger" data-cancel-lv="${r.leave_id}">Cancel</button></td>
                </tr>
              `;
            }).join('') : '<tr><td colspan="6" class="empty">No active leaves.</td></tr>'}
          </tbody>
        </table>
      </div>
    `;
    host.querySelectorAll('[data-cancel-lv]').forEach(b => {
      b.onclick = async () => {
        const id = b.getAttribute('data-cancel-lv');
        if (confirm('Cancel this leave?')) {
          await dbClient.from('leaves').update({ status: 'CANCELLED' }).eq('leave_id', id);
          await loadAllData();
          loadLdList('leave');
          toast('Leave cancelled');
        }
      };
    });
  } else {
    const rows = DB.dayOffs.filter(d => d.status === 'ACTIVE').sort((a, b) => b.date.localeCompare(a.date));
    host.innerHTML = `
      <div class="table-container">
        <table class="datatable">
          <thead>
            <tr>
              <th>Employee</th>
              <th>Date</th>
              <th>Post-Night?</th>
              <th>Reason</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            ${rows.length ? rows.map(r => {
              const s = getStaffById(r.staff_id);
              return `
                <tr>
                  <td><strong>${esc(s ? s.display_name : r.staff_id)}</strong></td>
                  <td>${r.date}</td>
                  <td>${r.related_night_duty === 'Y' ? 'Yes' : 'No'}</td>
                  <td>${esc(r.reason)}</td>
                  <td><button class="btn small danger" data-cancel-do="${r.dayoff_id}">Cancel</button></td>
                </tr>
              `;
            }).join('') : '<tr><td colspan="5" class="empty">No active day offs.</td></tr>'}
          </tbody>
        </table>
      </div>
    `;
    host.querySelectorAll('[data-cancel-do]').forEach(b => {
      b.onclick = async () => {
        const id = b.getAttribute('data-cancel-do');
        if (confirm('Cancel this day off?')) {
          await dbClient.from('day_offs').update({ status: 'CANCELLED' }).eq('dayoff_id', id);
          await loadAllData();
          loadLdList('dayoff');
          toast('Day off cancelled');
        }
      };
    });
  }
}

function renderLeaveForm(onDone) {
  const box = document.createElement('div');
  box.className = 'panel';
  box.innerHTML = `
    <div style="font-weight:700;margin-bottom:10px;color:var(--navy);">Record Leave</div>
    <div class="row">
      <div><label>Employee</label><select id="f_staff">${staffOptions()}</select></div>
      <div><label>Leave Type</label><input id="f_type" value="General"></div>
    </div>
    <div class="row">
      <div><label>From Date</label><input type="date" id="f_from" value="${STATE.date}"></div>
      <div><label>To Date</label><input type="date" id="f_to" value="${STATE.date}"></div>
    </div>
    <div class="row">
      <div><label>Replacement (Optional)</label><select id="f_rep"><option value=""> none </option>${staffOptions()}</select></div>
      <div><label>Reason</label><input id="f_reason" placeholder="Reason for leave"></div>
    </div>
    <div style="margin-top:14px;display:flex;gap:8px;">
      <button class="btn primary" id="f_submit">Save Leave</button>
      <button class="btn" id="f_cancel">Cancel</button>
    </div>
  `;
  box.querySelector('#f_cancel').onclick = () => box.remove();
  box.querySelector('#f_submit').onclick = async () => {
    const newLv = {
      leave_id: 'LV-' + String(Date.now()).slice(-5),
      staff_id: box.querySelector('#f_staff').value,
      leave_type: box.querySelector('#f_type').value,
      from_date: box.querySelector('#f_from').value,
      to_date: box.querySelector('#f_to').value,
      replacement_staff_id: box.querySelector('#f_rep').value,
      reason: box.querySelector('#f_reason').value,
      status: 'ACTIVE',
      created_at: new Date().toISOString().replace('T', ' ').slice(0, 16)
    };
    if (newLv.to_date < newLv.from_date) {
      alert('End date cannot be before start date.');
      return;
    }
    const { error } = await dbClient.from('leaves').insert([newLv]);
    if (error) {
      alert('Error saving leave: ' + error.message);
      return;
    }
    await loadAllData();
    toast('Leave saved');
    if (onDone) onDone();
  };
  return box;
}

function renderDayOffForm(onDone) {
  const box = document.createElement('div');
  box.className = 'panel';
  box.innerHTML = `
    <div style="font-weight:700;margin-bottom:10px;color:var(--navy);">Record Day Off</div>
    <div class="row">
      <div><label>Employee</label><select id="f_staff">${staffOptions()}</select></div>
      <div><label>Date</label><input type="date" id="f_date" value="${STATE.date}"></div>
      <div><label>Related to Night Duty?</label><select id="f_rel"><option value="N">No</option><option value="Y">Yes</option></select></div>
    </div>
    <div class="row">
      <div><label>Reason</label><input id="f_reason" placeholder="Reason for day off"></div>
    </div>
    <div style="margin-top:14px;display:flex;gap:8px;">
      <button class="btn primary" id="f_submit">Save Day Off</button>
      <button class="btn" id="f_cancel">Cancel</button>
    </div>
  `;
  box.querySelector('#f_cancel').onclick = () => box.remove();
  box.querySelector('#f_submit').onclick = async () => {
    const newDo = {
      dayoff_id: 'DO-' + String(Date.now()).slice(-5),
      staff_id: box.querySelector('#f_staff').value,
      date: box.querySelector('#f_date').value,
      related_night_duty: box.querySelector('#f_rel').value,
      reason: box.querySelector('#f_reason').value,
      status: 'ACTIVE',
      created_at: new Date().toISOString().replace('T', ' ').slice(0, 16)
    };
    const { error } = await dbClient.from('day_offs').insert([newDo]);
    if (error) {
      alert('Error saving day off: ' + error.message);
      return;
    }
    await loadAllData();
    toast('Day off saved');
    if (onDone) onDone();
  };
  return box;
}

// ---------- STAFF DIRECTORY VIEW ----------

window.editStaff = function(staffId) {
  let s = null;
  if (staffId) {
    s = DB.staff.find(x => x.staff_id === staffId);
  }
  
  const m = document.createElement('div');
  m.className = 'modal active';
  m.innerHTML = `
    <div class="modal-content" style="max-width: 500px;">
      <h3>${s ? 'Edit Staff' : 'Add New Staff'}</h3>
      <div style="margin-top:15px; display:grid; gap:10px;">
        <div><label>Staff ID (Unique)</label><input type="text" id="es_id" class="input" value="${s ? s.staff_id : ''}" ${s ? 'disabled' : ''}></div>
        <div><label>Full Name</label><input type="text" id="es_name" class="input" value="${s ? esc(s.display_name) : ''}"></div>
        <div><label>Alias (Short Name)</label><input type="text" id="es_alias" class="input" value="${s ? esc(s.alias) : ''}"></div>
        <div><label>Role / Designation</label><input type="text" id="es_role" class="input" value="${s ? esc(s.role) : 'Journalist'}"></div>
        <div><label>Desk</label>
          <select id="es_desk" class="input">
            <option value="">-- None --</option>
            ${DB.desks.map(d => `<option value="${d.desk_id}" ${s && s.desk_id === d.desk_id ? 'selected' : ''}>${esc(d.display_name)}</option>`).join('')}
          </select>
        </div>
        <div><label><input type="checkbox" id="es_in_charge" ${s && s.in_charge === 'Y' ? 'checked' : ''}> Is In-Charge?</label></div>
        <div><label><input type="checkbox" id="es_active" ${!s || s.active === 'Y' ? 'checked' : ''}> Is Active?</label></div>
      </div>
      <div style="margin-top:20px; display:flex; gap:10px; justify-content:flex-end;">
        <button class="btn btn-secondary" onclick="this.closest('.modal').remove()">Cancel</button>
        <button class="btn btn-primary" id="es_save">Save Staff</button>
      </div>
    </div>
  `;
  document.body.appendChild(m);
  
  m.querySelector('#es_save').onclick = async () => {
    const id = m.querySelector('#es_id').value.trim();
    const name = m.querySelector('#es_name').value.trim();
    const alias = m.querySelector('#es_alias').value.trim();
    const role = m.querySelector('#es_role').value.trim();
    const desk = m.querySelector('#es_desk').value;
    const inCharge = m.querySelector('#es_in_charge').checked ? 'Y' : 'N';
    const active = m.querySelector('#es_active').checked ? 'Y' : 'N';
    
    if (!id || !name) return alert('ID and Name are required!');
    
    const obj = {
      staff_id: id, canonical_name: name, display_name: name, alias, role, desk_id: desk, in_charge: inCharge, active
    };
    
    m.querySelector('#es_save').textContent = 'Saving...';
    try {
      if (s) {
        await dbClient.from('staff_master').update(obj).eq('staff_id', id);
        logAudit('UPDATE_STAFF', id, null, desk, JSON.stringify(s), JSON.stringify(obj), 'Admin edit', '');
      } else {
        await dbClient.from('staff_master').insert([obj]);
        // Insert empty schedule for all 7 days
        const days = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
        const pRoster = days.map(d => ({
          staff_id: id, day_of_week: d, shift_id: 'OFF'
        }));
        await dbClient.from('permanent_roster').insert(pRoster);
        logAudit('ADD_STAFF', id, null, desk, '', JSON.stringify(obj), 'Admin add', '');
      }
      toast('Staff saved successfully!');
      m.remove();
      // realtime will trigger reload, but let's reload anyway just in case
      await loadAllData();
      renderCurrentView();
    } catch(err) {
      alert('Error saving staff: ' + err.message);
      m.querySelector('#es_save').textContent = 'Save Staff';
    }
  };
};

function renderStaffDirectory(root) {
  const isAdmin = window.currentUserRole === 'admin';
  root.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 20px;">
      <div class="section-title" style="margin:0;">Staff Directory (${DB.staff.length} Employees)</div>
      ${isAdmin ? `<button class="btn btn-primary" id="btnAddStaff">+ Add New Staff</button>` : ''}
    </div>
    <div class="table-container">
      <table class="datatable">
        <thead>
          <tr>
            <th>ID</th>
            <th>Name</th>
            <th>Alias</th>
            <th>Desk</th>
            <th>Role</th>
            <th>In-Charge</th>
            <th>Status</th>
              ${isAdmin ? '<th>Actions</th>' : ''}
            </tr>
        </thead>
        <tbody>
          ${DB.staff.map(s => {
            const desk = getDeskById(s.desk_id);
            return `
              <tr>
                <td><code>${s.staff_id}</code></td>
                <td class="clickable" data-staff="${s.staff_id}"><strong>${esc(s.display_name)}</strong></td>
                <td>${esc(s.alias)}</td>
                <td>${esc(desk ? desk.display_name : s.desk_id)}</td>
                <td>${esc(s.role)}</td>
                <td>${toBool(s.in_charge) ? ' Yes' : ''}</td>
                <td>${toBool(s.active) ? '<span class="badge" style="background:#22c55e;">Active</span>' : '<span class="badge" style="background:#94a3b8;">Inactive</span>'}</td>
                  ${isAdmin ? `<td><button class="btn btn-secondary btn-sm" onclick="editStaff('${s.staff_id}')">Edit</button></td>` : ''}
                </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;

  
  const btnAdd = root.querySelector('#btnAddStaff');
  if (btnAdd) {
    btnAdd.addEventListener('click', () => {
      editStaff(null);
    });
  }

  root.querySelectorAll('[data-staff]').forEach(el => {
    el.addEventListener('click', () => showStaffModal(el.getAttribute('data-staff')));
  });
}

// ---------- SEARCH STAFF VIEW ----------
function renderSearch(root) {
  root.innerHTML = `
    <div class="section-title">Search Staff Directory</div>
    <input id="searchBox" placeholder="Type employee name, alias, desk, or role" style="max-width:360px;margin-bottom:14px;">
    <div id="searchResults"></div>
  `;

  const input = document.getElementById('searchBox');
  input.focus();
  input.oninput = (e) => {
    const q = e.target.value.toLowerCase().trim();
    const resHost = document.getElementById('searchResults');
    if (q.length < 2) {
      resHost.innerHTML = '';
      return;
    }

    const matches = DB.staff.filter(s => {
      const hay = (s.display_name + ' ' + s.alias + ' ' + s.role + ' ' + (s.canonical_name || '')).toLowerCase();
      if (hay.includes(q)) return true;
      return DB.nameMappings.some(m => m.roster_staff_id === s.staff_id && m.chat_name.toLowerCase().includes(q));
    });

    resHost.innerHTML = `
      <div class="table-container">
        <table class="datatable">
          <thead>
            <tr>
              <th>Name</th>
              <th>Alias</th>
              <th>Mobile</th>
              <th>Desk</th>
              <th>Role</th>
              <th>Today's Status</th>
            </tr>
          </thead>
          <tbody>
            ${matches.length ? matches.map(s => {
              const desk = getDeskById(s.desk_id);
              const duty = getEffectiveDutyForStaff(s.staff_id, todayStr());
              const st = computeStatus(duty, todayStr(), nowMinutesOfDay());
              return `
                <tr>
                  <td class="clickable" data-staff="${s.staff_id}"><strong>${esc(s.display_name)}</strong></td>
                  <td>${esc(s.alias)}</td>
                  <td>${s.notes ? esc(s.notes) : '-'}</td>
                  <td>${esc(desk ? desk.display_name : s.desk_id)}</td>
                  <td>${esc(s.role)}</td>
                  <td>${badgeHtml(st.badge, st.label)}</td>
                </tr>
              `;
            }).join('') : '<tr><td colspan="5" class="empty">No matching employees found.</td></tr>'}
          </tbody>
        </table>
      </div>
    `;

    resHost.querySelectorAll('[data-staff]').forEach(el => {
      el.addEventListener('click', () => showStaffModal(el.getAttribute('data-staff')));
    });
  };
}

// ---------- AUDIT LOG VIEW ----------
function renderAudit(root) {
  root.innerHTML = `
    <div class="section-title">System Audit Log (Last 200 Actions)</div>
    <div class="table-container">
      <table class="datatable">
        <thead>
          <tr>
            <th>Timestamp</th>
            <th>User</th>
            <th>Action</th>
            <th>Staff ID</th>
            <th>Date</th>
            <th>Reason / Details</th>
          </tr>
        </thead>
        <tbody>
          ${DB.auditLogs.length ? DB.auditLogs.map(a => `
            <tr>
              <td><code>${a.timestamp || ''}</code></td>
              <td>${esc(a.user_email || 'System')}</td>
              <td><strong>${esc(a.action)}</strong></td>
              <td>${esc(a.staff_id || '')}</td>
              <td>${esc(a.date || '')}</td>
              <td>${esc(a.reason || a.notes || '')}</td>
            </tr>
          `).join('') : '<tr><td colspan="6" class="empty">No audit logs recorded.</td></tr>'}
        </tbody>
      </table>
    </div>
  `;
}

// ---------- SETTINGS VIEW ----------
function renderSettings(root) {
  const configs = Object.keys(DB.config).map(k => ({ key: k, value: DB.config[k] }));

  root.innerHTML = `
    <div class="section-title">System Configuration &amp; Settings</div>
    <div class="table-container" style="margin-bottom:20px;">
      <table class="datatable">
        <thead>
          <tr>
            <th style="width:280px;">Configuration Key</th>
            <th>Value</th>
          </tr>
        </thead>
        <tbody>
          ${configs.map(c => `
            <tr>
              <td><code>${esc(c.key)}</code></td>
              <td><input data-cfg-key="${esc(c.key)}" value="${esc(c.value)}" style="max-width:450px;"></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
    <button class="btn primary" id="saveSettingsBtn"> Save All Settings</button>

    <div class="section-title" style="margin-top:30px;">Name Mappings (Chat Members  Roster Staff)</div>
    <div class="table-container" style="margin-bottom:20px;">
      <table class="datatable">
        <thead>
          <tr>
            <th>Chat Display Name</th>
            <th>Roster ID</th>
            <th>Roster Name</th>
            <th>Alias</th>
            <th>Status</th>
            <th>Confidence</th>
          </tr>
        </thead>
        <tbody>
          ${DB.nameMappings.map(m => `
            <tr>
              <td><strong>${esc(m.chat_name)}</strong></td>
              <td><code>${esc(m.roster_staff_id || '')}</code></td>
              <td>${esc(m.roster_name || '')}</td>
              <td>${esc(m.alias || '')}</td>
              <td><span class="badge" style="background:#64748b;">${esc(m.mapping_status)}</span></td>
              <td>${esc(m.confidence)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>

    <div class="section-title">Data Quality Warnings</div>
    <div class="table-container">
      <table class="datatable">
        <thead>
          <tr>
            <th>ID</th>
            <th>Category</th>
            <th>Description</th>
            <th>Severity</th>
            <th>Status</th>
              ${isAdmin ? '<th>Actions</th>' : ''}
            </tr>
        </thead>
        <tbody>
          ${DB.warnings.map(w => `
            <tr>
              <td><code>${w.warning_id}</code></td>
              <td>${esc(w.category)}</td>
              <td>${esc(w.description)}</td>
              <td><span class="badge" style="background:${w.severity === 'HIGH' ? '#dc2626' : (w.severity === 'MEDIUM' ? '#f97316' : '#3b82f6')};">${w.severity}</span></td>
              <td>${esc(w.status)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;

  document.getElementById('saveSettingsBtn').onclick = async () => {
    const inputs = root.querySelectorAll('[data-cfg-key]');
    const updates = [];
    inputs.forEach(inp => {
      const k = inp.getAttribute('data-cfg-key');
      const v = inp.value;
      updates.push(dbClient.from('system_config').upsert([{ key: k, value: v }]));
    });

    await Promise.all(updates);
    await loadAllData();
    toast('Settings successfully saved');
  };
}

// ==============================================================================
// 5. APPLICATION INITIALIZATION
// ==============================================================================
document.addEventListener('DOMContentLoaded', async () => {
  STATE.date = todayStr();
  bindNav();

  const root = document.getElementById('viewRoot');
  
  if (!window.supabase) {
    root.innerHTML = '<div class="conflict-box" style="margin:20px;"><h3>Network Error</h3><p>Could not load the Supabase database client. Please ensure you have an active internet connection and that jsdelivr.net is not blocked.</p></div>';
    return;
  }
  
  // Initialize Supabase Client
  dbClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // AUTH LOGIC
  const loginScreen = document.getElementById('loginScreen');
  const appScreen = document.getElementById('app');
  const loginBtn = document.getElementById('btnLogin');
  const loginEmail = document.getElementById('loginEmail');
  const loginPass = document.getElementById('loginPass');
  const loginError = document.getElementById('loginError');
  const logoutBtn = document.getElementById('btnLogout');

  let currentUser = null;
  window.window.currentUserRole = 'user'; // default

  async function checkAuth() {
    const { data: { session } } = await dbClient.auth.getSession();
    if (session && session.user) {
      currentUser = session.user;
      window.currentUserRole = session.user.user_metadata?.role || 'user';
      loginScreen.style.display = 'none';
      appScreen.style.display = 'flex';
      
      document.querySelectorAll('#navlist li').forEach(li => {
        if (li.getAttribute('data-view') === 'settings' || li.getAttribute('data-view') === 'audit') {
          li.style.display = window.currentUserRole === 'admin' ? 'block' : 'none';
        }
      });
      
      startApp();
    } else {
      loginScreen.style.display = 'flex';
      appScreen.style.display = 'none';
    }
  }

  dbClient.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT') {
      currentUser = null;
      window.currentUserRole = 'user';
      loginScreen.style.display = 'flex';
      appScreen.style.display = 'none';
    }
  });

  loginBtn.onclick = async () => {
    try {
      loginError.style.display = 'none';
      loginBtn.textContent = 'Logging in...';
      const email = loginEmail.value.trim();
      const password = loginPass.value.trim();
      
      const res = await dbClient.auth.signInWithPassword({ email, password });
      if (res.error) {
        loginError.textContent = res.error.message;
        loginError.style.display = 'block';
      } else {
        await checkAuth();
      }
    } catch(err) {
      loginError.textContent = 'Fatal Error: ' + err.message;
      loginError.style.display = 'block';
      console.error(err);
    }
    loginBtn.textContent = 'Log In';
  };

  if (logoutBtn) {
    logoutBtn.onclick = async () => {
      await dbClient.auth.signOut();
    };
  }

  async function startApp() {
    if (window.appStarted) return;
    window.appStarted = true;
    root.innerHTML = '<div class="empty"> Connecting to Supabase and loading data</div>';
    try {
      await loadAllData();
      initRealtime();
      renderCurrentView();
    } catch (err) {
      root.innerHTML = `
        <div class="conflict-box" style="margin:20px;">
          <h3>Database Setup Required</h3>
          <p>Could not load tables from Supabase: <strong>${esc(err.message)}</strong></p>
          <pre style="font-size: 11px; white-space: pre-wrap; margin-top: 10px;">${esc(err.stack)}</pre>
        </div>
      `;
    }
  }

  await checkAuth();
});
