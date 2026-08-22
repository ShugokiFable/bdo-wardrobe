# One-shot migration/audit after entity-decode rename (not part of the app pipeline)
import json, os, re
cat = json.load(open("data/catalog.json", encoding="utf-8"))
st = json.load(open("data/images.json", encoding="utf-8"))
imgs, errs = st["images"], st["errors"]
valid = {o["id"] for o in cat["outfits"]}

# fix Te'enah: te-8194... -> teenah
for store in (imgs, errs):
    old = "maehwa--te-8217-enah"
    if old in store:
        store["maehwa--teenah"] = store.pop(old)
        e = imgs.get("maehwa--teenah")
        if isinstance(e, dict) and e.get("file", "").startswith("maehwa--te-8217"):
            p_old = os.path.join("public", "assets", "images", e["file"])
            nf = "new"  # placeholder
            nf = "maehwa--teenah" + os.path.splitext(e["file"])[1]
            if os.path.exists(p_old):
                os.replace(p_old, os.path.join("public", "assets", "images", nf))
                e["file"] = nf

cov_img = {i for i in imgs if i in valid}
cov_err = {i for i in errs if i in valid}
stale_img = [i for i in imgs if i not in valid]
stale_err = [i for i in errs if i not in valid]
both = cov_img & cov_err
missing = valid - cov_img - cov_err
print("valid:", len(valid), "| img-covered:", len(cov_img), "| err-covered:", len(cov_err))
print("stale img keys:", stale_img)
print("stale err keys:", stale_err)
print("in BOTH stores:", sorted(both))
print("MISSING from both:", len(missing), sorted(missing)[:25])
st["done"] = len(imgs); st["total"] = len(valid)
json.dump(st, open("data/images.json", "w", encoding="utf-8"))
