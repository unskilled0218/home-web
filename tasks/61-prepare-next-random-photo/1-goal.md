# goal

## command

While displaying one image, read `/photos`, pick a random image to display next, and repeat this cycle.

## goal

While displaying the current image, randomly select and prepare one next image from the discovered photo library. Switch when it is ready, then repeat. Refresh the library periodically to detect added or removed files instead of rereading `/photos` for every transition. If preparation fails, keep the current image visible.
