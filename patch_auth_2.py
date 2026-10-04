import re

auth_js = '''
  // AUTH LOGIC
  const loginScreen = document.getElementById('loginScreen');
  const appScreen = document.getElementById('app');
  const loginBtn = document.getElementById('btnLogin');
  const loginEmail = document.getElementById('loginEmail');
  const loginPass = document.getElementById('loginPass');
  const loginError = document.getElementById('loginError');
  const logoutBtn = document.getElementById('btnLogout');

  let currentUser = null;
  let currentUserRole = 'user'; // default

  async function checkAuth() {
    const { data: { session } } = await dbClient.auth.getSession();
    if (session && session.user) {
      currentUser = session.user;
      currentUserRole = session.user.user_metadata?.role || 'user';
      loginScreen.style.display = 'none';
      appScreen.style.display = 'flex';
      startApp();
    } else {
      loginScreen.style.display = 'flex';
      appScreen.style.display = 'none';
    }
  }

  dbClient.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT') {
      currentUser = null;
      currentUserRole = 'user';
      loginScreen.style.display = 'flex';
      appScreen.style.display = 'none';
    }
  });

  loginBtn.onclick = async () => {
    loginError.style.display = 'none';
    loginBtn.textContent = 'Logging in...';
    const email = loginEmail.value.trim();
    const password = loginPass.value.trim();
    
    const { data, error } = await dbClient.auth.signInWithPassword({ email, password });
    if (error) {
      loginError.textContent = error.message;
      loginError.style.display = 'block';
    } else {
      await checkAuth();
    }
    loginBtn.textContent = 'Log In';
  };

  if (logoutBtn) {
    logoutBtn.onclick = async () => {
      await dbClient.auth.signOut();
    };
  }

  async function startApp() {
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
'''

with open('app.js', 'r', encoding='utf-8') as f:
    c = f.read()

# Replace init block
pat = re.compile(r'dbClient = window\.supabase\.createClient\(SUPABASE_URL, SUPABASE_ANON_KEY\);\s*root\.innerHTML = \'<div class="empty"> Connecting to Supabase and loading data</div>\';\s*try \{.*?</div>\s*`;\s*\}', re.DOTALL)
c = pat.sub(f'dbClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);\n{auth_js}\n  await checkAuth();', c)

# Enforce Permissions based on currentUserRole
# 1. Hide System Settings tab from non-admins
c = c.replace("document.querySelectorAll('#navlist li').forEach(li => {", "document.querySelectorAll('#navlist li').forEach(li => {\n    if (li.getAttribute('data-view') === 'settings' && currentUserRole !== 'admin') { li.style.display = 'none'; }")

# 2. Make Permanent Schedule read-only for non-admins
c = c.replace('<select class="inline-select"', '<select class="inline-select" ${currentUserRole !== \'admin\' ? \'disabled\' : \'\'}')

# 3. Prevent non-admins from changing the view to settings
c = c.replace("switch(STATE.view) {", "if (STATE.view === 'settings' && currentUserRole !== 'admin') STATE.view = 'dashboard';\n  switch(STATE.view) {")

with open('app.js', 'w', encoding='utf-8') as f:
    f.write(c)
print('Done patching')
