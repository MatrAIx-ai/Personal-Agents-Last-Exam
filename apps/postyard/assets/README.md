`cover.jpg` is the synthetic cover for `ac-0001:p1`. It is a small JPEG, 32 by 24, listed in `contribution/assets.catalog.json` as `cover-checksum`. The public resource interface reads it through `postyard.blog.posts.get`.

A note image is not part of this catalog. `notes.post` copies the selected bytes onto the new note. Put those bytes in the seed `media` array, with `bytes_base64`, and pass that `asset_id`. The public runtime then owns the copy under the note id.
