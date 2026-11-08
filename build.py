"""Builds the artifact page (avatar-dome.html) from index.html.

The artifact host adds its own <html>/<head>/<body>, so this keeps only the
content between the BUILD markers and the body, and inlines the avatar photo
and the vendored DialKit script and stylesheet.
Run: python3 build.py
"""
import base64, pathlib, re

root = pathlib.Path(__file__).parent
src = (root / "index.html").read_text()

head = src.split("<!-- BUILD:CUT-ABOVE -->")[1].split("<!-- BUILD:HEAD-END -->")[0]
body = re.search(r"<body>(.*)</body>", src, re.S).group(1)
page = head.strip() + "\n" + body.strip() + "\n"

photo = base64.b64encode((root / "assets/avatar.jpg").read_bytes()).decode()
page = page.replace("assets/avatar.jpg", "data:image/jpeg;base64," + photo)

# Inline the vendored DialKit files: the artifact can't load local files
css = (root / "vendor/dialkit/styles.css").read_text()
js = (root / "vendor/dialkit/browser.global.js").read_text()
page = page.replace('<link rel="stylesheet" href="vendor/dialkit/styles.css">', "<style>\n" + css + "\n</style>")
page = page.replace('<script src="vendor/dialkit/browser.global.js"></script>', "<script>\n" + js + "\n</script>")
assert "vendor/dialkit" not in page, "DialKit was not inlined"

(root / "avatar-dome.html").write_text(page)
print("wrote avatar-dome.html", len(page), "bytes")
