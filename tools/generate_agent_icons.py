from pathlib import Path
import runpy
runpy.run_path(str(Path(__file__).resolve().parents[1]/'branding'/'agent_icon_source.py'),run_name='__main__')
