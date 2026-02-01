আপনার `README.md` ফাইলটি এমনভাবে তৈরি করা হয়েছে যেন ভবিষ্যতে \*\*AI (যেমন ChatGPT, Claude)\*\* বা কোনো নতুন ডেভেলপার এটি পড়েই পুরো \*\*Appwrite Database Schema\*\* এবং \*\*API Structure\*\* বুঝতে পারে।



এটি কপি করে `README.md` ফাইলে সেভ করুন।



```markdown

\# 📡 pbsNet Backend Server Documentation



This is the Node.js (Express) backend for \*\*pbsNet\*\*, integrated with \*\*Appwrite\*\*. It serves as the central API for authentication, user profile management, and admin operations.



---



\## 🛠 Configuration \& Environment



Ensure your `.env` file matches this structure. The application relies on these specific keys.



```ini

\# Appwrite Connection

APPWRITE\_ENDPOINT=\[https://cloud.appwrite.io/v1](https://cloud.appwrite.io/v1)

APPWRITE\_PROJECT\_ID=pbsnet

APPWRITE\_API\_KEY=your\_admin\_api\_key\_here



\# Database IDs

DATABASE\_ID=central\_db

COLLECTION\_PROFILE=user\_profiles

BUCKET\_ID=profile\_pics



\# Security

JWT\_SECRET=your\_jwt\_secret\_here



\# Frontend

FRONTEND\_URL=\[https://pbsnet.pages.dev](https://pbsnet.pages.dev)



```



---



\## 🗄️ Appwrite Database Schema



The system uses a single collection: `user\_profiles`.



\### Collection ID: `user\_profiles`



\*\*Attributes \& Indexes:\*\*



| Key | Type | Size | Required | Index Type | Description |

| --- | --- | --- | --- | --- | --- |

| `full\_name` | String | 128 | Yes | \*\*FullText\*\* | Required for text search API. |

| `mobile` | String | 15 | Yes | \*\*Unique\*\* | Primary identifier for Login. |

| `email` | String | 128 | Yes | \*\*Unique\*\* | Backup identifier/Login. |

| `username` | String | 32 | No | \*\*Unique\*\* | Unique profile handle. |

| `pbs\_name` | String | 50 | No | Key | Filterable field. |

| `office\_name` | String | 50 | No | Key | Filterable field. |

| `post\_name` | String | 50 | No | Key | Filterable field. |

| `api\_key` | String | 128 | No | \*\*Unique\*\* | Key for external/admin access. |

| `profile\_pic\_id` | String | 128 | No | - | File ID from Appwrite Storage. |

| `personal\_json` | String | 5000 | No | - | \*\*Stringified JSON\*\*. Stores all dynamic app data. |



> \*\*AI Context:\*\* `personal\_json` acts as a NoSQL document. We do not create separate columns for app settings, billing, or social links. Everything goes into this JSON string.



---



\## 🔌 API Endpoints Reference



\### 1. Authentication (Public)



No headers required.



| Method | Endpoint | Body Parameters | Description |

| --- | --- | --- | --- |

| `POST` | `/api/auth/register` | `email`, `password`, `name` | Creates Auth User + DB Document. |

| `POST` | `/api/auth/login` | `identifier` (Mobile/Email), `password` | Smart login. Returns \*\*JWT Token\*\*. |

| `GET` | `/api/auth/google` | - | Returns OAuth2 Redirect URL. |

| `POST` | `/api/auth/forgot-password` | `email` | Sends recovery link. |

| `POST` | `/api/auth/retrieve-key` | `identifier`, `password` | Returns `api\_key` without JWT. |



\### 2. Profile Management (Protected)



\*\*Header Required:\*\* `Authorization: Bearer <JWT\_TOKEN>`



| Method | Endpoint | Description | Body / Query |

| --- | --- | --- | --- |

| `GET` | `/api/me` | Fetch full profile \& `personal\_json`. | - |

| `PUT` | `/api/me` | Update Core Info. | `{ full\_name, mobile, post\_name, office\_name, pbs\_name }` |

| `PATCH` | `/api/me/json` | Merge update `personal\_json`. | `{ any\_key: "value" }` |

| `POST` | `/api/me/username` | Set unique username. | `{ newUsername: "..." }` |

| `POST` | `/api/me/pass` | Change Password. | `{ newPassword: "..." }` |

| `POST` | `/api/me/key` | Rotate API Key. | - |

| `POST` | `/api/me/pic` | Upload Avatar. | \*\*FormData:\*\* `avatar` (File) |

| `GET` | `/api/users/search` | Search Users. | `?pbs=...\&office=...\&mobile=...\&username=...\&search=Name` |



\### 3. Admin Operations (Protected)



\*\*Header Required:\*\* `x-admin-secret: <APPWRITE\_API\_KEY>`



| Method | Endpoint | Description | Body Parameters |

| --- | --- | --- | --- |

| `POST` | `/api/admin/user-app-data/view` | View user data. | `{ target\_user\_key, subclass (optional) }` |

| `PATCH` | `/api/admin/user-app-data` | Update specific JSON section. | `{ target\_user\_key, subclass, data: {} }` |



---



\## 🧠 Logic \& Rules for AI Development



If you are an AI assistant updating this code, adhere to these rules:



1\. \*\*Smart Login Logic:\*\*

The login route checks if the `identifier` contains `@`.

\* If `@` is present -> Treats as \*\*Email\*\*.

\* If `@` is absent -> Treats as \*\*Mobile\*\* (Queries DB to find email, then logs in).





2\. \*\*Subclass Update Strategy (Admin):\*\*

When updating `personal\_json` via Admin API, do NOT overwrite the whole string.

\* \*\*Parse\*\* existing JSON.

\* \*\*Target\*\* the specific `subclass` key (e.g., `billing`).

\* \*\*Merge\*\* new data with old data: `json\[subclass] = { ...old, ...new }`.

\* \*\*Stringify\*\* and save.





3\. \*\*Search Logic:\*\*

\* `Query.equal` is used for: `pbs\_name`, `office\_name`, `mobile`, `username`.

\* `Query.search` is used for: `full\_name`. \*\*Note:\*\* This requires a FullText Index on `full\_name` in Appwrite.





4\. \*\*File Uploads:\*\*

\* Always use `multer.memoryStorage()`.

\* Delete the old file from Appwrite Storage (using `profile\_pic\_id`) before uploading a new one to save space.







```



```

