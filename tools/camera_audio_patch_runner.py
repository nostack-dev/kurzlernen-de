import runpy
import subprocess

runpy.run_path("tools/camera_audio_patch.py", run_name="__main__")
subprocess.run(["git","checkout","--",".github/workflows/deploy.yml"],check=True)
