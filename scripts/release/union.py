# Union-resolve git conflict blocks: keep ours, then theirs lines not already present.
# Asset tags (src/href=*.js|css|json) dedupe by filename (ours wins; versions re-bumped later).
import re,sys
asset=re.compile(r'(?:src|href)="([^"?]+\.(?:js|css|json))')
blk=re.compile(r'^<<<<<<< [^\n]*\n(.*?)^(?:\|\|\|\|\|\|\| [^\n]*\n.*?)?^=======\n(.*?)^>>>>>>> [^\n]*\n',re.S|re.M)
for f in sys.argv[1:]:
    s=open(f).read()
    def rep(m):
        ours=m.group(1).splitlines(True); theirs=m.group(2).splitlines(True)
        names={a.group(1) for l in ours for a in [asset.search(l)] if a}
        out=list(ours)
        for l in theirs:
            a=asset.search(l)
            if a and a.group(1) in names: continue
            if l in ours: continue
            out.append(l)
        return ''.join(out)
    s2,n=blk.subn(rep,s)
    open(f,'w').write(s2); print(f,n,'blocks','LEFT' if '<<<<<<<' in s2 else 'ok')
