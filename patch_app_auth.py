import glob, re

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

def patch_auth(f):
    with open(f, 'r', encoding='utf-8') as file:
        content = file.read()
    
    if 'async function checkAuth()' not in content:
        # replace the init block
        old_init = """    dbClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  
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
    }"""
        
        new_init = f"    dbClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);\n{auth_js}\n    await checkAuth();"
        content = content.replace(old_init, new_init)
        
        # Enforce Permissions based on currentUserRole
        
        # 1. Hide System Settings tab from non-admins
        old_nav = "document.querySelectorAll('#navlist li').forEach(li => {"
        new_nav = """document.querySelectorAll('#navlist li').forEach(li => {
    if (li.getAttribute('data-view') === 'settings' && currentUserRole !== 'admin') {
      li.style.display = 'none';
    }
"""
        content = content.replace(old_nav, new_nav)
        
        # 2. Make Permanent Schedule read-only for non-admins
        # we can just modify updatePermanentRoster to block it on JS side, AND hide the `<select>` tag if not admin, or just disable it.
        # Let's just disable the select dropdowns in dayCells if not admin
        old_select = '<select class="inline-select"'
        new_select = '<select class="inline-select" ${currentUserRole !== \'admin\' ? \'disabled\' : \'\'}'
        content = content.replace(old_select, new_select)
        
        # 3. Prevent non-admins from changing the view to settings
        old_switch = "switch(STATE.view) {"
        new_switch = "if (STATE.view === 'settings' && currentUserRole !== 'admin') STATE.view = 'dashboard';\n  switch(STATE.view) {"
        content = content.replace(old_switch, new_switch)
        
        # User is allowed to: Leave/DayOff, Changes & Exceptions, Audit Log, Dashboard, Visual Timeline, Staff Directory (View only)
        # We don't have "Edit Staff" implemented yet anyway.
        
        with open(f, 'w', encoding='utf-8') as file:
            file.write(content)
        print("Patched app.js")

for f in ['app.js']:
    patch_auth(f)
