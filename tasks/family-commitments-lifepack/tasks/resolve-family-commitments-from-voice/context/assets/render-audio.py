"""Render fictional voices locally. Requires espeakng-loader==0.2.4 and imageio-ffmpeg==0.6.0."""
import ctypes as c
from pathlib import Path
import subprocess
import espeakng_loader
import imageio_ffmpeg

root = Path(__file__).resolve().parent
lib = espeakng_loader.load_library()
rate = lib.espeak_Initialize(2, 0, espeakng_loader.get_data_path().encode(), 0)
assert rate > 0
parts = []
callback_type = c.CFUNCTYPE(c.c_int, c.POINTER(c.c_short), c.c_int, c.c_void_p)

@callback_type
def collect(samples, count, events):
    if samples and count:
        parts.append(c.string_at(samples, count * 2))
    return 0

lib.espeak_SetSynthCallback(collect)
voices = {'Rui': ('en-us+f3', 134), 'Mei': ('en+f4', 137), 'Sam': ('en-us+m3', 132)}
for turn in (root / 'saturday-arrangements.txt').read_text().strip().split('\n\n'):
    person, words = turn.split(': ', 1)
    voice, speed = voices[person]
    assert lib.espeak_SetVoiceByName(voice.encode()) == 0
    assert lib.espeak_SetParameter(1, speed, 0) == 0
    encoded = words.encode('utf-8')
    assert lib.espeak_Synth(encoded, len(encoded) + 1, 0, 1, 0, 1, None, None) == 0
    parts.append(bytes(rate))
pcm = b''.join(parts)
seconds = len(pcm) / (rate * 2)
assert 180 <= seconds <= 300, seconds
subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), '-hide_banner', '-loglevel', 'error', '-y',
                '-f','s16le','-ar',str(rate),'-ac','1','-i','pipe:0','-map_metadata','-1',
                '-c:a','libopus','-application','voip','-b:a','18k',str(root/'saturday-arrangements.ogg')],
               input=pcm, check=True)
print(f'{seconds:.2f}s, {rate} Hz synthesis; mono Ogg Opus')
