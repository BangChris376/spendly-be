git rm --cached -r aiServer
rmdir /s /q aiServer
git add .
git commit -m "Remove AI server from backend repo"
git push origin main
