# 🧾 Invoice IQ (GST Guardian)

### AI-Powered GST Compliance & Invoice Verification System

---

## 🚀 Overview

**Invoice IQ** is a smart web application designed to help MSMEs automate invoice validation and GST compliance.
It uses **OCR + AI + GST API integration** to extract invoice data, verify GSTIN authenticity, detect fraud, and provide actionable insights.

---

## 🎯 Key Features

### 📤 Invoice Upload

* Upload invoices in **PDF / JPG / PNG**
* Drag-and-drop interface
* Secure file validation

---

### 🧠 OCR & Data Extraction

* AI-based invoice parsing (Vision Model)
* Fallback OCR using Tesseract
* Extracts:

  * GSTIN
  * Invoice Number
  * Date
  * Seller & Buyer Details
  * Tax values (CGST, SGST, IGST)

---

### 🔍 GSTIN Verification (Hybrid)

* Real-time verification using **GSTINCheck API**
* Fallback to local GST database if API fails
* Validates:

  * GSTIN format
  * Status (Active/Inactive)
  * Business name match

---

### ⚠️ Error & Warning Detection

* **Errors (Critical)**:

  * Invalid GSTIN
  * Missing fields
  * Incorrect tax calculations

* **Warnings (Non-critical)**:

  * Seller name mismatch
  * Suspicious patterns
  * Minor inconsistencies

---

### 🛡️ Fraud Detection

* Detects:

  * Duplicate invoices
  * Name mismatch
  * Abnormal values
* Generates **Fraud Risk Score**:

  * Low / Medium / High

---

### 📊 Dashboard

* Displays:

  * Extracted invoice data
  * Compliance score (0–100)
  * Fraud risk
  * Status (Valid / Warning / Error)
* Includes search and filtering

---

### 💡 Suggestions Engine

* Provides human-readable explanations
* Suggests fixes for each issue

---

## 🧱 Tech Stack

### Frontend

* React.js
* Tailwind CSS
* Chart.js

### Backend

* Python (FastAPI / Flask)

### AI & OCR

* Vision AI (Lovable AI / Gemini)
* Tesseract OCR
* OpenCV

### Database

* MongoDB / Firebase

---

## 🔐 Security Features

* JWT Authentication
* Password hashing (bcrypt)
* API key stored in `.env`
* Input validation & sanitization
* Rate limiting
* Secure file handling

---

## 🔄 System Architecture

```
Invoice Upload
      ↓
AI OCR (Primary)
      ↓
Tesseract OCR (Fallback)
      ↓
Data Extraction
      ↓
GSTIN Verification (API)
      ↓
Fallback Database (if API fails)
      ↓
Validation + Fraud Detection
      ↓
Dashboard Output
```

---

## ⚙️ Installation & Setup

### 1. Clone the repository

```bash
git clone https://github.com/your-username/invoice-iq.git
cd invoice-iq
```

---

### 2. Backend Setup

```bash
cd backend
pip install -r requirements.txt
```

Create `.env` file:

```env
GST_API_KEY=your_api_key_here
SECRET_KEY=your_secret_key
```

Run server:

```bash
uvicorn main:app --reload
```

---

### 3. Frontend Setup

```bash
cd frontend
npm install
npm start
```

---

## 🔌 API Endpoints

| Method | Endpoint        | Description         |
| ------ | --------------- | ------------------- |
| POST   | /upload-invoice | Upload invoice      |
| POST   | /validate-gstin | Verify GSTIN        |
| GET    | /invoice/{id}   | Get invoice details |
| GET    | /dashboard-data | Dashboard data      |

---

## 📁 Sample Validation Response

```json
{
  "status": "Error",
  "compliance_score": 70,
  "fraud_risk": "High",
  "errors": [
    {
      "field": "GSTIN",
      "issue": "Invalid format",
      "suggestion": "Use valid GSTIN structure"
    }
  ],
  "warnings": [
    {
      "field": "Seller Name",
      "issue": "Mismatch with GST records",
      "suggestion": "Verify seller details"
    }
  ]
}
```

---

## 🎯 Future Enhancements

* Bulk invoice processing
* Export reports (PDF/Excel)
* Chatbot for compliance queries
* Real GSTN API integration
* ML-based anomaly detection

---

## 🧠 Project Highlights

* Hybrid OCR system (AI + fallback)
* Hybrid GST verification (API + local DB)
* Explainable validation (errors + warnings)
* Strong focus on **security + fraud detection**

---

## 🎓 Viva Pitch

> “Invoice IQ is an AI-powered GST compliance assistant that automates invoice validation using OCR, verifies GSTIN authenticity through APIs, detects fraud patterns, and provides explainable insights to improve financial accuracy and compliance.”

---

## 👩‍💻 Contributors

* Varsha R
* Team Members

---

## 📜 License

This project is for academic and demonstration purposes.
