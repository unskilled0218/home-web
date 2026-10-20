# goal

## command

Display images in batches and choose the next batch while the current batch plays, without duplicates. Ten images is an example, not a fixed batch size.

## goal

Play randomly selected batches, showing one image at a time. Choose a batch size suited to memory use and preparation time rather than fixing it at 10. While the current batch plays, queue the next batch's image metadata and decode only the next image ahead. Avoid duplicates within and between batches until every eligible image has been shown, then start a new shuffled cycle without an immediate boundary repeat when multiple images are available. Use a smaller batch when fewer unseen images remain. Refresh the library periodically, and keep the current image visible if preparation fails.
