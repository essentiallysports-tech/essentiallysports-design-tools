# bump.py KEY: set ?v=KEY on every HTML reference to a JS/CSS/JSON file changed vs origin/main.
import re,subprocess,sys,os
KEY=sys.argv[1]
changed=set(subprocess.check_output(['git','diff','--name-only','origin/main','HEAD']).decode().split())
changed={c for c in changed if c.endswith(('.js','.css','.json'))}
htmls=subprocess.check_output(['git','ls-files','*.html']).decode().split()
pat=re.compile(r'((?:src|href)=")((?:\.\./)?)([\w./-]+\.(?:js|css|json))\?v=([\w.-]+)(")')
n=0
for h in htmls:
    s=open(h).read()
    def rep(m):
        global n
        path=os.path.normpath(os.path.join(os.path.dirname(h),m.group(2)+m.group(3)))
        if path in changed and m.group(4)!=KEY: n+=1; return m.group(1)+m.group(2)+m.group(3)+'?v='+KEY+m.group(5)
        return m.group(0)
    s2=pat.sub(rep,s)
    if s2!=s: open(h,'w').write(s2)
print('bumped',n,'refs; changed assets',len(changed))
