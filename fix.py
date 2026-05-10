with open('public/governance.html', 'r', errors='ignore') as f:
    c = f.read()

# 1. Fix checkbox: remove first cssText and disabled from creation
# The pattern has the render log and two cssText assignments
old1 = "cb.title='Toggle completion';console.log('[RENDER] '+mid+' isComp='+isComp+' compDate='+st.compDate);cb.style.cssText='cursor:pointer;width:16px;height:16px';\n    cb.disabled=!EDIT_MODE;"
new1 = "cb.title='Toggle completion';console.log('[RENDER] '+mid+' isComp='+isComp+' compDate='+st.compDate);"
c = c.replace(old1, new1)
print("1. Checkbox fixed - first cssText+disabled removed:", old1 not in c)

# 2. Fix date input: remove disabled from creation
old2 = "compIn.disabled=!EDIT_MODE;"
c = c.replace(old2, "")
print("2. Date input fixed:", old2 not in c)

# 3. Fix file input: remove disabled from creation
old3 = "fileIn.disabled=!EDIT_MODE;"
c = c.replace(old3, "")
print("3. File input fixed:", old3 not in c)

# 4. Fix selAll: remove disabled from creation
old4 = "selAll.disabled=!EDIT_MODE;"
c = c.replace(old4, "")
print("4. Select all fixed:", old4 not in c)

# 5. Add syncEditMode to end of ALL()
old5 = "function ALL(){RM();RS();RD();RAC()}"
new5 = "function ALL(){RM();RS();RD();RAC();syncEditMode();}"
c = c.replace(old5, new5)
print("5. ALL() calls syncEditMode():", new5 in c)

# 6. Remove syncEditMode from startEdit (ALL() will call it)
old6 = "updateEditButtons();syncEditMode();ALL();}"
new6 = "updateEditButtons();ALL();}"
c = c.replace(old6, new6)
print("6. startEdit cleaned up:", old6 not in c)

# 7. Fix facility change to also call syncEditMode
idx = c.find("document.getElementById('fs').addEventListener('change',e=>{EDIT_MODE=false;")
if idx >= 0:
    end = c.find('});', idx)
    old8 = c[idx:end+3]
    if 'syncEditMode' not in old8:
        new8 = old8.replace('});', 'syncEditMode();});')
        c = c[:idx] + new8 + c[end+3:]
        print("7. Facility change calls syncEditMode():", 'syncEditMode' in new8)
    else:
        print("7. Already has syncEditMode")

# Also need to remove compIn.disabled from the progress tab section
# (compIn exists in both progress and deliverables - need to check)
count = c.count("compIn.disabled")
print(f"   Remaining compIn.disabled: {count}")

with open('public/governance.html', 'w') as f:
    f.write(c)
print("Written")
