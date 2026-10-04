import glob, re

new_daycells = """          const dayCells = days.map(d => {
            const r = DB.roster.find(ro => ro.staff_id === s.staff_id && ro.weekday === d.weekday);
            let currentVal = r ? (r.shift_type === 'OFF' ? 'OFF' : r.shift_code) : '';
            if (!currentVal && r && r.shift_type === 'Night') currentVal = '11pm';
            
            let cls = currentVal === 'OFF' ? 'off' : (currentVal === '11pm' ? 'night' : '');
            
            let optionsHtml = `<option value="OFF" ${currentVal === 'OFF' ? 'selected' : ''}>OFF</option>`;
            DB.shifts.forEach(shift => {
              optionsHtml += `<option value="${shift.shift_code}" ${currentVal === shift.shift_code ? 'selected' : ''}>${shift.shift_code}</option>`;
            });
            
            return `<div class="cell ${cls}" style="padding:0;">
              <select class="inline-select" onchange="updatePermanentRoster('${s.staff_id}', '${d.weekday}', this.value); this.parentElement.className = 'cell ' + (this.value === 'OFF' ? 'off' : (this.value === '11pm' ? 'night' : ''));">
                ${optionsHtml}
              </select>
            </div>`;
          }).join('');"""

for f in glob.glob('*.js') + glob.glob('*.html'):
    with open(f, 'r', encoding='utf-8') as file:
        content = file.read()
    
    # We will use regex to find the old block and replace it
    pattern = re.compile(r'          const dayCells = days\.map\(d => \{.*?return `<div class="cell \$\{cls\}">\$\{esc\(label\)\}</div>`;\s*\}\)\.join\(\'\'\);', re.DOTALL)
    
    new_content = pattern.sub(new_daycells, content)
    
    if new_content != content:
        with open(f, 'w', encoding='utf-8') as file:
            file.write(new_content)
        print(f"Patched {f}")
