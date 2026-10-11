"""Run the same deterministic gates on pull requests and deployments."""
import pathlib
import re
import subprocess

root = pathlib.Path(__file__).resolve().parents[1]
workflow = '\n'.join((root / '.github/workflows' / name).read_text() for name in ['deploy.yml', 's31-hil.yml'])
commands = []
for line in workflow.splitlines():
    command = line.strip()
    if re.match(r'node (tests/[^ ]+|--check sim/[^ ]+)($| )', command):
        if 'sil_wasm_smoke' not in command:
            commands.append(command.split())
for test in sorted((root / 'tests').glob('*_regression_test.mjs')):
    commands.append(['node', str(test.relative_to(root))])
seen = set()
for command in commands:
    key = tuple(command)
    if key in seen:
        continue
    seen.add(key)
    subprocess.run(command, cwd=root, check=True)
subprocess.run(['g++', '-std=c++17', '-O2', '-Wall', '-Wextra', '-Wpedantic', '-Werror', '-Iesp32', 'tests/state_control_test.cpp', '-o', '/tmp/state_control_test'], cwd=root, check=True)
subprocess.run(['/tmp/state_control_test'], check=True)
