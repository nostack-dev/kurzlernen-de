from pathlib import Path
p=Path("tests/architecture_invariants.mjs")
text=p.read_text()
old='"child.isGridHelper&&this.gridEnabled"'
new='"if(child.isGridHelper){child.visible=this.gridEnabled;continue;}"'
assert text.count(old)==1, f"expected one old WORLD grid invariant, got {text.count(old)}"
p.write_text(text.replace(old,new,1))
