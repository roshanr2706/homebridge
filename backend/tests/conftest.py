import os, sys
os.environ.setdefault("HB_NO_AUTOAPP", "1")
os.environ.setdefault("HB_AUTOPILOT_TICK", "0")   # no background autopilot thread in tests
os.environ.setdefault("LLM_PROVIDER", "offline")
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
