"""Lối tắt: gun_tool.py đã được mở rộng thành asset_tool.py (cùng các chế độ cũ)."""
import runpy, os
runpy.run_path(os.path.join(os.path.dirname(os.path.abspath(__file__)), "asset_tool.py"), run_name="__main__")
