; Keep the executable beside, but never inside, the managed model/data root.
; The assisted installer adds no extra folder because APP_FILENAME is already
; part of this default path. Users can still select another location.
!macro customInit
  StrCpy $INSTDIR "D:\open-tts\OpenTTS Studio"
!macroend
