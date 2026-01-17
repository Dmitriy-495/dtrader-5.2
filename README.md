u# 🚀 DTrader-5 - Next Generation Trading Bot

Микросервисная архитектура для автоматического трейдинга на Gate.io.

## 📊 Архитектура 1

```
┌─────────────────────────────────────────────────────────────┐
│                         DTRADER-5                           │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│  │   bot/   │  │ strategy/│  │  trader/ │  │   risk/  │   │
│  │ Node+TS  │  │  Python  │  │  Python  │  │  Python  │   │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘   │
│       │             │             │             │          │
│       └─────────────┴─────────────┴─────────────┘          │
│                         │                                   │
│                    ┌────▼────┐                             │
│                    │  REDIS  │                             │
│                    │ Pub/Sub │                             │
│                    └────┬────┘                             │
│                         │                                   │
│                    ┌────▼────┐                             │
│                    │ws-server│                             │
│                    │ Node+TS │                             │
│                    └─────────┘                             │
└─────────────────────────────────────────────────────────────┘
```

## 🏗️ Сервисы

### Instance A: Redis

Центральная шина данных, pub/sub, event sourcing.

### Instance B: Bot (Node.js + TypeScript)

Сбор данных с Gate.io WebSocket, Balance, Order Book.

### Instance C: Strategy (Python)

Анализ рынка, индикаторы, ML модели, генерация сигналов.

### Instance D: Trader (Python → Go)

Исполнение ордеров, tracking позиций.

### Instance E: Risk Manager (Python)

Контроль рисков, стоп-лоссы, лимиты.

### Instance F: WS-Server (Node.js + TypeScript)

Broadcasting данных для фронтенда через WebSocket.
