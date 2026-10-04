import os

missing_css = """
/* Visual Dashboard CSS */
.gantt-grid {
  display: grid;
  grid-template-columns: repeat(16, 1fr);
  gap: 1px;
  background-color: #e2e8f0;
  border: 1px solid #e2e8f0;
}
.gantt-header, .gantt-row {
  display: contents;
}
.gantt-cell {
  background-color: #ffffff;
  padding: 8px 4px;
  font-size: 11px;
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  position: relative;
  min-height: 40px;
}
.gantt-name {
  font-weight: 500;
  font-size: 13px;
  background-color: #f8fafc;
  color: #334155;
  border-right: 1px solid #e2e8f0;
}
.gantt-time-header {
  font-weight: 600;
  background-color: #f1f5f9;
  color: #64748b;
  border-bottom: 2px solid #cbd5e1;
}
.duty-bar {
  position: absolute;
  top: 6px;
  bottom: 6px;
  border-radius: 4px;
  z-index: 10;
  opacity: 0.9;
  box-shadow: 0 1px 3px rgba(0,0,0,0.1);
  display: flex;
  align-items: center;
  padding-left: 8px;
  color: white;
  font-size: 10px;
  overflow: hidden;
  white-space: nowrap;
}
.bar-central { background-color: #3b82f6; }
.bar-bd { background-color: #10b981; }
.bar-global { background-color: #f59e0b; }
.bar-sports { background-color: #ec4899; }
.bar-night { background-color: #1e293b; }

.bar-inch { background-color: #ef4444; }
.bar-rel { background-color: #8b5cf6; }
.bar-ent { background-color: #14b8a6; }
.bar-rep { background-color: #64748b; }

.bar-other { background-color: #8b5cf6; }
.btn-primary { background: #3b82f6; color: white; border: 1px solid #3b82f6; }
.btn-outline { background: transparent; color: #3b82f6; border: 1px solid #3b82f6; }


/* Fullscreen Mode CSS */
body.fullscreen-mode #nav {
  display: none !important;
}
body.fullscreen-mode #main {
  margin-left: 0 !important;
  width: 100% !important;
}


.inline-select {
  width: 100%;
  height: 100%;
  border: none;
  background: transparent;
  text-align: center;
  font-family: inherit;
  font-size: inherit;
  font-weight: inherit;
  color: inherit;
  cursor: pointer;
  appearance: none;
  outline: none;
}
.inline-select:hover {
  background: rgba(0,0,0,0.05);
}
.inline-select option {
  color: #000;
}
"""

with open('styles.css', 'a', encoding='utf-8') as f:
    f.write('\n' + missing_css)
