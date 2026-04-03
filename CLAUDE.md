# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Agent de voz em tempo real que captura áudio do microfone, transcreve via Whisper (OpenAI) e reproduz respostas via TTS (ElevenLabs), com cache inteligente de áudio. Escrito em TypeScript, roda em **Bun** (não Node.js).

## Commands

```bash
# Rodar o agente
bun run index.ts

# Instalar dependências
bun install
```

Não há testes, linter ou build step configurados.

## Architecture

Três módulos independentes em `src/modules/`, cada um com seu Controller como API pública:

### voice-capture
Captura áudio via **ffmpeg** (DirectShow/dshow no Windows) e transcreve com **OpenAI Whisper**.
- `VoiceCaptureController` → `VoiceCapture` → múltiplos `Capturer` (processos ffmpeg) + `TranscriptionPipeline`
- Rotação de capturers com zero-gap: inicia o próximo antes de parar o atual
- **VAD em tempo real**: `Capturer.checkVAD()` calcula RMS energy a cada 500ms nos chunks recentes; após 3 checks com fala confirmada + silêncio >= `silenceThresholdMs`, dispara rotação
- **Auto-tune**: calibra thresholds de VAD com ruído ambiente na inicialização
- Suporta mute/unmute (usado durante reprodução TTS para evitar eco)

### tts
Sintetiza e reproduz áudio via **ElevenLabs API**, com fila de prioridade.
- `TTSController` → `TTSPipeline` → `Synthesizer` (API) + `AudioPlayer` (ffmpeg) + `PriorityQueue`
- Pipeline com concorrência configurável: múltiplas sínteses em paralelo, playback sequencial ordenado por timestamp
- Integra com cache via hooks: `setCacheResolver` (lookup) e `onAudioGenerated` (store)

### tts-cache
Cache persistente de áudio com tracking de frequência e re-geração automática.
- `TTSCacheController` → `CacheStore` + `WordTracker` + `SentenceBuilder` + `RegenQueue`
- Duas qualidades: **native** (API direta) e **stitched** (montado de partes)
- Auto-upgrade: frases stitched frequentes são re-geradas como native em background (1 por vez, com delay para não competir com TTS principal)
- Persistência: `cache/tts-index.json` (índice), `cache/audio/` (arquivos), `cache/word-tracker.json` (frequências)

### Fluxo principal (`index.ts`)
```
Microfone → ffmpeg → Capturer (VAD) → TranscriptionPipeline (Whisper)
    → onTranscription → TTSController.speak()
        → cache hit? → AudioPlayer
        → cache miss? → ElevenLabs API → AudioPlayer + cache store
    → durante playback: mute microfone → ao terminar: unmute com 500ms delay
```

## Configuration

Configs JSON em `config/`: `voice-capture.json`, `tts.json`, `tts-cache.json`. Controllers carregam e mesclam com defaults em runtime. Updates via `setConfig()` persistem no arquivo.

## Environment Variables

- `OPENAI_API_KEY` — Whisper transcription
- `ELEVENLABS_API_KEY` — TTS synthesis

## Key Patterns

- Todos os módulos usam **Bun APIs** (`Bun.spawn`, `Bun.file`, `Bun.write`) — não usar Node.js equivalents
- ffmpeg é dependência externa de runtime (captura de áudio e playback)
- Código e logs estão em português brasileiro
- Plataforma alvo: Windows (dshow para captura de áudio)
