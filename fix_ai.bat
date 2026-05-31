git rm --cached -r aiServer
rmdir /s /q aiServer\aiServer\.git
xcopy /E /H /Y aiServer\aiServer\* aiServer\
rmdir /s /q aiServer\aiServer
git add .
git commit -m "Fix AI folder structure"
git push origin main
