"""Draws the placeholder app icon (a pixel-art townhouse) at 1024 px.

Run from the project folder, then let Tauri make every size from it:
    python3 scripts/make-icon.py
    npx tauri icon src-tauri/icons/source-1024.png
Needs Pillow (python3 -m pip install pillow). Replace with real artwork later.
"""
from PIL import Image, ImageDraw
N=32; S=32  # 32x32 pixel grid, 32 px per cell -> 1024
img=Image.new('RGBA',(N*S,N*S),(0,0,0,0))
d=ImageDraw.Draw(img)
# background tile: rounded square, deep blue
d.rounded_rectangle([0,0,N*S-1,N*S-1],radius=180,fill=(28,42,70,255))
g=[[None]*N for _ in range(N)]
def r(x0,y0,x1,y1,c):
    for y in range(y0,y1+1):
        for x in range(x0,x1+1): g[y][x]=c
STONE=(222,200,160,255); SHADE=(186,160,118,255); DARK=(120,98,70,255)
GLASS=(110,170,220,255); GLASS2=(70,120,180,255); ROOF=(176,84,56,255); ROOF2=(140,62,42,255)
DOOR=(96,62,40,255); GOLD=(240,190,70,255)
# pediment (triangle) rows 4..9
for i,y in enumerate(range(4,10)):
    r(15-i-1,y,16+i+1,y,ROOF if i<5 else ROOF2)
r(15,3,16,3,ROOF)
r(14,6,17,7,STONE)  # oculus surround
r(15,6,16,7,GOLD)
# cornice
r(5,10,26,10,STONE); r(6,11,25,11,SHADE)
# wall body
r(7,12,24,26,STONE)
# pilasters
for x in (7,12,19,24): r(x,12,x,26,SHADE)
# windows: two floors x three bays
for y0 in (13,19):
    for x0 in (9,15,21):
        r(x0,y0,x0+1,y0+3,GLASS); r(x0,y0,x0+1,y0,GLASS2)
        r(x0-1,y0+4,x0+2,y0+4,DARK)  # sill
# string course
r(7,18,24,18,SHADE)
# base: door in middle bay replaces lower window
r(15,19,16,23,GLASS); r(15,24,16,26,DOOR)
r(14,19,14,26,SHADE); r(17,19,17,26,SHADE)
# plinth/steps
r(6,27,25,27,SHADE); r(5,28,26,28,DARK)
for y in range(N):
    for x in range(N):
        if g[y][x]: d.rectangle([x*S,y*S,x*S+S-1,y*S+S-1],fill=g[y][x])
img.save('src-tauri/icons/source-1024.png')
