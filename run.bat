@echo off
echo ========================================
echo    🎬 PAAJI MOVIE TRACKER
echo ========================================
echo.
echo Starting local server...
echo.
echo Your data will be saved in: %CD%\movie-data.json
echo.
echo Access the app at: http://localhost:8000
echo.
echo Press Ctrl+C to stop the server
echo.
python -m http.server 8000
pause