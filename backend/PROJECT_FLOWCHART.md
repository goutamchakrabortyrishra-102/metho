# Backend Project Flowchart

```mermaid
flowchart TD
    A[User Action] --> B[Frontend API Call]
    B --> C[Backend Route /api/*]
    C --> D{Mode}

    D -->|Full| E[server.py]
    D -->|Simple| F[server_simple.py]
    D -->|SQL| G[sql_app.main]

    E --> H[Validate + Business Rules]
    G --> H
    F --> H

    H --> I[Order/Member/Settings Processing]
    I --> J[Commission Pool Calculation]
    J --> K[5-way Split]
    K --> K1[Member Pool]
    K --> K2[Leader Pool]
    K --> K3[MPS Fund]
    K --> K4[Company Fund]
    K --> K5[Tech Reserve]

    I --> L[Wallet + Ledger Update]
    I --> M[Invoice + Notifications]
    I --> N[Admin Monitoring]

    N --> O[/api/admin/system-health]
    O --> P[Dashboard Health View]

    K1 --> Q[Month-end Settlement]
    K2 --> Q
    Q --> R[Member/Leader Reward Distribution]
```

## Human Reading Notes
- সব payout সরাসরি route-level validation পাস করার পর হয়।
- system-health endpoint operational summary দেখায়।
- auto alerts/scheduler logic backend side-এ কিছু জায়গায় রয়েছে (mode dependent)।
