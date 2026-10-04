import glob

login_html = '''<body>
<div id="loginScreen" style="display:flex; height:100vh; align-items:center; justify-content:center; background:#f1f5f9;">
  <div style="background:#fff; padding:30px; border-radius:12px; box-shadow:0 4px 12px rgba(0,0,0,0.1); width:320px; text-align:center;">
    <h2 style="color:#0b1a2b; margin-bottom:20px;">Somoy TV Roster</h2>
    <input type="email" id="loginEmail" class="input" placeholder="Email" style="width:100%; margin-bottom:12px; padding:10px; border:1px solid #cbd5e1; border-radius:6px; box-sizing:border-box;">
    <input type="password" id="loginPass" class="input" placeholder="Password" style="width:100%; margin-bottom:20px; padding:10px; border:1px solid #cbd5e1; border-radius:6px; box-sizing:border-box;">
    <button id="btnLogin" style="width:100%; padding:10px; background:#3b82f6; color:#fff; border:none; border-radius:6px; font-weight:bold; cursor:pointer;">Log In</button>
    <div id="loginError" style="color:red; font-size:12px; margin-top:10px; display:none;"></div>
  </div>
</div>
<div id="app" style="display:none;">
'''

for f in ['index.html']:
    with open(f, 'r', encoding='utf-8') as file:
        content = file.read()
    
    if '<div id="loginScreen"' not in content:
        content = content.replace('<body>\n<div id="app">', login_html)
        # also add a logout button in the topbar of #nav
        logout_btn = '<li id="btnLogout" style="cursor:pointer; color:#ef4444; margin-top:auto; font-weight:bold;">🚪 Logout</li>\n    </ul>'
        content = content.replace('</ul>', logout_btn)
        
        with open(f, 'w', encoding='utf-8') as file:
            file.write(content)
        print('Patched index.html')
