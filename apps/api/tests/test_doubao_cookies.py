import json

from tts_api.doubao_cookies import CookieSecretCodec, DoubaoCookiePool


class TestCodec(CookieSecretCodec):
    prefix = "test-encrypted:"

    def protect(self, value: str) -> str:
        return self.prefix + value[::-1]

    def unprotect(self, value: str) -> str:
        return value.removeprefix(self.prefix)[::-1] if value.startswith(self.prefix) else value


def test_cookie_pool_encrypts_disk_value_and_redacts_list(tmp_path):
    path = tmp_path / "doubao-cookies.json"
    pool = DoubaoCookiePool(path, codec=TestCodec())
    created = pool.add(name="主账号", value="sessionid=very-secret", description="测试")

    assert "value" not in created
    assert "value" not in pool.list()[0]
    stored_text = path.read_text(encoding="utf-8")
    assert "sessionid=very-secret" not in stored_text
    assert "test-encrypted:" in stored_text

    reloaded = DoubaoCookiePool(path, codec=TestCodec())
    record = reloaded.get(created["id"], include_value=True)
    assert record["value"] == "sessionid=very-secret"


def test_cookie_pool_rotates_after_configured_usage_limit(tmp_path):
    pool = DoubaoCookiePool(tmp_path / "cookies.json", codec=TestCodec())
    first = pool.add(name="账号一", value="cookie-one")
    second = pool.add(name="账号二", value="cookie-two")
    pool.configure_rotation(usage_limit_enabled=True, usage_count_per_cookie=1)

    selected = pool.select()
    assert selected["id"] == first["id"]
    pool.record_usage(first["id"], success=True)
    selected = pool.select()

    assert selected["id"] == second["id"]
    assert pool.stats()["totalRotations"] == 1


def test_invalid_cookie_is_removed_from_selection(tmp_path):
    pool = DoubaoCookiePool(tmp_path / "cookies.json", codec=TestCodec())
    first = pool.add(name="账号一", value="cookie-one")
    second = pool.add(name="账号二", value="cookie-two")

    pool.mark_validation(first["id"], valid=False, message="block")

    assert pool.select()["id"] == second["id"]
    assert pool.stats()["valid"] == 1
