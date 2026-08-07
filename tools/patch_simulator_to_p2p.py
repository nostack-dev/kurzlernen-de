from pathlib import Path
path=Path('sim/simulator.mjs')
s=path.read_text()
legacy='\nif(remoteParams.get("room")&&remoteLink.relayUrl())await connectRemote();'
assert legacy in s
s=s.replace(legacy,'',1)
assert 'remoteParams' not in s
assert 'connectRemote' not in s
assert 'relayUrl()' not in s
assert '/control' not in s
assert 'new ViewPeerLink()' in s
path.write_text(s)
