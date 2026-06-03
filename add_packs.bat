@echo off
cd /d "%~dp0backend"
call venv\Scripts\activate.bat
python -c "
from database import SessionLocal
from models import UserProfile
db = SessionLocal()
p = db.query(UserProfile).first()
p.standard_packs = (p.standard_packs or 0) + 10
db.commit()
print('Done! Standard packs now:', p.standard_packs)
db.close()
"
pause
