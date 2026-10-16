- [command](#command)
- [goal](#goal)

## command

- Fix image loading for large photo libraries. The deployed server has over 7,000 images, but the dashboard loads only one.
  - Correct scan-budget handling: after directory enumeration reaches the 5,000-entry limit, processing currently stops after the first file instead of processing the entries already collected.
  - Review the separate scan and slideshow-pool limits, including the current 100-photo pool cap, and clearly distinguish those limits from the number of images in the library.
  - Add regression coverage for directories exceeding the scan-entry limit while preserving bounded filesystem access and image-streaming protections.

## goal

Fix photo discovery for large libraries so scan-budget exhaustion does not stop processing after one file. Clarify scan and slideshow-pool limits separately from total library size. Add regression coverage while preserving bounded filesystem access and image-streaming protections.
