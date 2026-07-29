# Frontend Project Flowchart

```mermaid
flowchart TD
    A[User opens page] --> B[React Route]
    B --> C[Page Component]
    C --> D[Load data via api client]
    D --> E[/api backend endpoint]
    E --> F[Response JSON]
    F --> G[State update]
    G --> H[UI render]

    H --> I{User action}
    I -->|Create/Edit| J[Form submit]
    I -->|Approve/Reject| K[Admin action]
    I -->|Share| L[Share/WhatsApp flow]
    I -->|Refresh| M[Manual/Auto refresh]

    J --> D
    K --> D
    L --> N[Link/PDF/Native share]
    M --> D

    subgraph Admin Monitoring
      O[SystemHealthPage] --> P[/api/admin/system-health]
      P --> Q[Health cards + alerts + logs]
    end
```

## Human Reading Notes
- সব page এ data flow এক: API call -> state update -> render.
- role-based access থাকায় admin pages non-admin user-এ block হতে পারে.
- system health page এখন initial load + interval refresh support করে.
