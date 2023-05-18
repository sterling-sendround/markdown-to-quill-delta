
## Markdown to Quill Delta converter

Converts Markdown to [Quill Delta](https://quilljs.com/docs/delta/) using [remark](https://github.com/remarkjs/remark).

## Status

| Feature      | Status |
| ------------ | ------ |
| Paragraphs   | ✅     |
| Headers      | ✅     |
| Text styling | ✅     |
| Code blocks  | ✅     |
| Quote blocks | ❌     |
| Lists        | ✅     |
| Checkboxes   | ✅     |
| Links        | ✅¹    |
| Images       | ✅     |

¹: reference-style links are not yet supported

### Modifications from the original
This repo has been updated to include the following features:
* indented ordered and bulleted lists
* update heading conversion to match current Quill delta structure

## Usage

```typescript
import markdownToDelta from "markdown-to-quill-delta";
const ops = markdownToDelta(markdown);
```

## What about Delta to Markdown?

See [here](https://github.com/sterling-sendround/quill-delta-to-markdown).

## License

forked from [frysztak's repo](https://github.com/frysztak/markdown-to-quill-delta)
Licensed under ISC License.
