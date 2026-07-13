"""
Test suite for Billing Report endpoints (Relatório de Faturamento)
Tests the new billing report feature that generates PDF and Excel reports
with financial columns (client, service type, invoice number, operation value).
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test credentials
TEST_EMAIL = "joao.victor@jalogisticas.com"
TEST_PASSWORD = "password123"


@pytest.fixture(scope="module")
def auth_token():
    """Get authentication token for API requests."""
    response = requests.post(f"{BASE_URL}/api/auth/login", json={
        "email": TEST_EMAIL,
        "password": TEST_PASSWORD
    })
    if response.status_code == 200:
        return response.json().get("access_token")
    pytest.skip("Authentication failed - cannot proceed with tests")


@pytest.fixture
def api_client():
    """Shared requests session."""
    session = requests.Session()
    session.headers.update({"Content-Type": "application/json"})
    return session


@pytest.fixture
def authenticated_client(api_client, auth_token):
    """Session with auth header."""
    api_client.headers.update({"Authorization": f"Bearer {auth_token}"})
    return api_client


# ==================== EXISTING REPORTS - ENSURE THEY STILL WORK ====================

class TestExistingReportsEndpoints:
    """Verify existing movement report endpoints still function correctly."""

    def test_existing_pdf_report_returns_200(self, authenticated_client):
        """GET /api/reports/pdf should still return 200."""
        response = authenticated_client.get(f"{BASE_URL}/api/reports/pdf")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        assert response.headers.get('content-type') == 'application/pdf', "Expected PDF content type"
        assert len(response.content) > 0, "PDF content should not be empty"
        print("PASS: Existing PDF report endpoint works correctly")

    def test_existing_excel_report_returns_200(self, authenticated_client):
        """GET /api/reports/excel should still return 200."""
        response = authenticated_client.get(f"{BASE_URL}/api/reports/excel")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        assert 'spreadsheetml' in response.headers.get('content-type', ''), "Expected Excel content type"
        assert len(response.content) > 0, "Excel content should not be empty"
        print("PASS: Existing Excel report endpoint works correctly")

    def test_existing_pdf_report_with_filters(self, authenticated_client):
        """GET /api/reports/pdf with filters should return 200."""
        response = authenticated_client.get(f"{BASE_URL}/api/reports/pdf", params={
            "operation_type": "ENTRADA"
        })
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        assert response.headers.get('content-type') == 'application/pdf', "Expected PDF content type"
        print("PASS: Existing PDF report with filters works correctly")

    def test_existing_excel_report_with_filters(self, authenticated_client):
        """GET /api/reports/excel with filters should return 200."""
        response = authenticated_client.get(f"{BASE_URL}/api/reports/excel", params={
            "operation_type": "SAIDA",
            "status_filter": "CHEIO"
        })
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        assert 'spreadsheetml' in response.headers.get('content-type', ''), "Expected Excel content type"
        print("PASS: Existing Excel report with filters works correctly")


# ==================== NEW BILLING REPORT ENDPOINTS ====================

class TestBillingPDFEndpoint:
    """Test the new billing PDF report endpoint."""

    def test_billing_pdf_returns_200(self, authenticated_client):
        """GET /api/reports/billing/pdf should return 200 and PDF content."""
        response = authenticated_client.get(f"{BASE_URL}/api/reports/billing/pdf")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        assert response.headers.get('content-type') == 'application/pdf', "Expected PDF content type"
        assert len(response.content) > 0, "PDF content should not be empty"
        # Check for PDF header
        assert response.content[:4] == b'%PDF', "Response should be valid PDF"
        print("PASS: Billing PDF endpoint returns 200 with valid PDF")

    def test_billing_pdf_with_billed_filter(self, authenticated_client):
        """GET /api/reports/billing/pdf?billed_filter=billed should return 200."""
        response = authenticated_client.get(f"{BASE_URL}/api/reports/billing/pdf", params={
            "billed_filter": "billed"
        })
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        assert response.headers.get('content-type') == 'application/pdf', "Expected PDF content type"
        print("PASS: Billing PDF with billed_filter=billed works correctly")

    def test_billing_pdf_with_unbilled_filter(self, authenticated_client):
        """GET /api/reports/billing/pdf?billed_filter=unbilled should return 200."""
        response = authenticated_client.get(f"{BASE_URL}/api/reports/billing/pdf", params={
            "billed_filter": "unbilled"
        })
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        assert response.headers.get('content-type') == 'application/pdf', "Expected PDF content type"
        print("PASS: Billing PDF with billed_filter=unbilled works correctly")

    def test_billing_pdf_with_operation_type_filter(self, authenticated_client):
        """GET /api/reports/billing/pdf?operation_type=ENTRADA should return 200."""
        response = authenticated_client.get(f"{BASE_URL}/api/reports/billing/pdf", params={
            "operation_type": "ENTRADA"
        })
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        assert response.headers.get('content-type') == 'application/pdf', "Expected PDF content type"
        print("PASS: Billing PDF with operation_type filter works correctly")

    def test_billing_pdf_with_status_filter(self, authenticated_client):
        """GET /api/reports/billing/pdf?status_filter=CHEIO should return 200."""
        response = authenticated_client.get(f"{BASE_URL}/api/reports/billing/pdf", params={
            "status_filter": "CHEIO"
        })
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        assert response.headers.get('content-type') == 'application/pdf', "Expected PDF content type"
        print("PASS: Billing PDF with status_filter works correctly")

    def test_billing_pdf_with_multiple_filters(self, authenticated_client):
        """GET /api/reports/billing/pdf with multiple filters should return 200."""
        response = authenticated_client.get(f"{BASE_URL}/api/reports/billing/pdf", params={
            "operation_type": "ENTRADA",
            "billed_filter": "unbilled",
            "status_filter": "VAZIO"
        })
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        assert response.headers.get('content-type') == 'application/pdf', "Expected PDF content type"
        print("PASS: Billing PDF with multiple filters works correctly")

    def test_billing_pdf_requires_auth(self, api_client):
        """GET /api/reports/billing/pdf without auth should return 401 or 403."""
        response = api_client.get(f"{BASE_URL}/api/reports/billing/pdf")
        assert response.status_code in [401, 403], f"Expected 401 or 403, got {response.status_code}"
        print("PASS: Billing PDF endpoint requires authentication")


class TestBillingExcelEndpoint:
    """Test the new billing Excel report endpoint."""

    def test_billing_excel_returns_200(self, authenticated_client):
        """GET /api/reports/billing/excel should return 200 and Excel content."""
        response = authenticated_client.get(f"{BASE_URL}/api/reports/billing/excel")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        assert 'spreadsheetml' in response.headers.get('content-type', ''), "Expected Excel content type"
        assert len(response.content) > 0, "Excel content should not be empty"
        # Check for Excel header (XLSX is a zip file starting with PK)
        assert response.content[:2] == b'PK', "Response should be valid XLSX (starts with PK)"
        print("PASS: Billing Excel endpoint returns 200 with valid Excel")

    def test_billing_excel_with_billed_filter(self, authenticated_client):
        """GET /api/reports/billing/excel?billed_filter=billed should return 200."""
        response = authenticated_client.get(f"{BASE_URL}/api/reports/billing/excel", params={
            "billed_filter": "billed"
        })
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        assert 'spreadsheetml' in response.headers.get('content-type', ''), "Expected Excel content type"
        print("PASS: Billing Excel with billed_filter=billed works correctly")

    def test_billing_excel_with_unbilled_filter(self, authenticated_client):
        """GET /api/reports/billing/excel?billed_filter=unbilled should return 200."""
        response = authenticated_client.get(f"{BASE_URL}/api/reports/billing/excel", params={
            "billed_filter": "unbilled"
        })
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        assert 'spreadsheetml' in response.headers.get('content-type', ''), "Expected Excel content type"
        print("PASS: Billing Excel with billed_filter=unbilled works correctly")

    def test_billing_excel_with_operation_type_filter(self, authenticated_client):
        """GET /api/reports/billing/excel?operation_type=SAIDA should return 200."""
        response = authenticated_client.get(f"{BASE_URL}/api/reports/billing/excel", params={
            "operation_type": "SAIDA"
        })
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        assert 'spreadsheetml' in response.headers.get('content-type', ''), "Expected Excel content type"
        print("PASS: Billing Excel with operation_type filter works correctly")

    def test_billing_excel_with_multiple_filters(self, authenticated_client):
        """GET /api/reports/billing/excel with multiple filters should return 200."""
        response = authenticated_client.get(f"{BASE_URL}/api/reports/billing/excel", params={
            "billed_filter": "unbilled",
            "operation_type": "ENTRADA",
            "status_filter": "CHEIO"
        })
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        assert 'spreadsheetml' in response.headers.get('content-type', ''), "Expected Excel content type"
        print("PASS: Billing Excel with multiple filters works correctly")

    def test_billing_excel_requires_auth(self, api_client):
        """GET /api/reports/billing/excel without auth should return 401 or 403."""
        response = api_client.get(f"{BASE_URL}/api/reports/billing/excel")
        assert response.status_code in [401, 403], f"Expected 401 or 403, got {response.status_code}"
        print("PASS: Billing Excel endpoint requires authentication")


class TestBillingReportContentDisposition:
    """Test that billing reports have correct content-disposition headers."""

    def test_billing_pdf_has_correct_filename(self, authenticated_client):
        """Billing PDF should have correct filename in content-disposition."""
        response = authenticated_client.get(f"{BASE_URL}/api/reports/billing/pdf")
        assert response.status_code == 200
        disposition = response.headers.get('content-disposition', '')
        assert 'relatorio_faturamento.pdf' in disposition, f"Expected filename in disposition, got: {disposition}"
        print("PASS: Billing PDF has correct filename in content-disposition")

    def test_billing_excel_has_correct_filename(self, authenticated_client):
        """Billing Excel should have correct filename in content-disposition."""
        response = authenticated_client.get(f"{BASE_URL}/api/reports/billing/excel")
        assert response.status_code == 200
        disposition = response.headers.get('content-disposition', '')
        assert 'relatorio_faturamento.xlsx' in disposition, f"Expected filename in disposition, got: {disposition}"
        print("PASS: Billing Excel has correct filename in content-disposition")


class TestBillingReportDateFilters:
    """Test date range filtering for billing reports."""

    def test_billing_pdf_with_date_range(self, authenticated_client):
        """GET /api/reports/billing/pdf with date range should return 200."""
        response = authenticated_client.get(f"{BASE_URL}/api/reports/billing/pdf", params={
            "date_from": "2024-01-01",
            "date_to": "2026-12-31"
        })
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        assert response.headers.get('content-type') == 'application/pdf', "Expected PDF content type"
        print("PASS: Billing PDF with date range works correctly")

    def test_billing_excel_with_date_range(self, authenticated_client):
        """GET /api/reports/billing/excel with date range should return 200."""
        response = authenticated_client.get(f"{BASE_URL}/api/reports/billing/excel", params={
            "date_from": "2024-01-01",
            "date_to": "2026-12-31"
        })
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        assert 'spreadsheetml' in response.headers.get('content-type', ''), "Expected Excel content type"
        print("PASS: Billing Excel with date range works correctly")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
