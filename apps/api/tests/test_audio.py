from tts_api.audio import create_output_path, output_text_preview


def test_output_text_preview_keeps_a_short_readable_text_prefix():
    assert output_text_preview("  你好， 这是\n一个文件名测试。更多内容  ") == "你好，这是一个文件名测试。更多内容"


def test_output_text_preview_removes_invalid_windows_filename_characters():
    assert output_text_preview("\u6807\u9898: <\u6d4b\u8bd5>/\\?*") == "\u6807\u9898__\u6d4b\u8bd5"


def test_create_output_path_uses_text_preview_with_timestamp_and_unique_token(tmp_path):
    text = "\u8fd9\u662f\u751f\u6210\u8bed\u97f3\u7684\u53ef\u8bfb\u6807\u9898\uff0c\u540e\u9762\u7684\u5185\u5bb9\u4e0d\u9700\u8981\u5199\u8fdb\u6587\u4ef6\u540d"
    first = create_output_path(tmp_path, ".wav", text)
    second = create_output_path(tmp_path, "mp3", text)

    assert first.parent == tmp_path
    assert first.suffix == ".wav"
    assert second.suffix == ".mp3"
    assert first.name.startswith(f"{output_text_preview(text)}_")
    assert first.name != second.name
