import {visit} from 'unist-util-visit'
import Op from "quill-delta/dist/Op";
import {unified} from 'unified';
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'

type Test = (node: any, op: any) => boolean;
type Action = (node: any, op: any) => any;

class CustomAction {
  test: Test;
  action: Action;
  
  constructor(test: Test, action: Action) {
    this.test = test;
    this.action = action;
  }
}

export default function markdownToDelta(md: string): Op[] {
  const processor = unified().use(remarkParse).use(remarkGfm);
  const tree: any = processor.parse(md);

  const ops: Op[] = [];
  const addNewline = () => ops.push({ insert: "\n" });

  const flatten = (arr: any[]): any[] =>
    arr.reduce((flat, next) => flat.concat(next), []);

  const listVisitor = (node: any) => {
    if (node.ordered && node.start !== 1) {
      throw Error("Quill-Delta numbered lists must start from 1.");
    }

    visit(node, "listItem", listItemVisitor(node));
  };

  const listItemVisitor = (listNode: any) => (node: any) => {
    for (const child of node.children) {
      if (child.type === "paragraph") {
        visit(child, "paragraph", paragraphVisitor());
      } else if (child.type === "list") {
        continue
      }

      let indent = 0;
      let listAttribute = "";
      if (listNode.ordered) {
        listAttribute = "ordered";
        indent = Math.floor(child.position.start.column / 3) - 1;
      } else if (node.checked) {
        listAttribute = "checked";
      } else if (node.checked === false) {
        listAttribute = "unchecked";
      } else {
        listAttribute = "bullet";
        indent = Math.floor(child.position.start.column / 2) - 1;
      }
      let delta: any = { insert: "\n", attributes: { list: listAttribute } };
      if (indent !== 0) {
        delta.attributes.indent = indent;
      }
      ops.push(delta);
    }
  };

  const paragraphVisitor = (initialOp: Op = {}, custom: CustomAction[] = []) => (node: any) => {
    const { children } = node;

    const visitNode = (node: any, op: Op): Op[] | Op => {
      let customMatch = false;
      for (var ca of custom) {
        if (ca.test(node, op)) {
          customMatch = true;
          op = ca.action(node, op);
          break;
        }
      }
      if (customMatch) {
        return op;
      }
      if (node.type === "text") {
        op = { ...op, insert: node.value };
      } else if (node.type === "strong") {
        op = { ...op, attributes: { ...op.attributes, bold: true } };
        return visitChildren(node, op);
      } else if (node.type === "emphasis") {
        op = { ...op, attributes: { ...op.attributes, italic: true } };
        return visitChildren(node, op);
      } else if (node.type === "delete") {
        op = { ...op, attributes: { ...op.attributes, strike: true } };
        return visitChildren(node, op);
      } else if (node.type === "image") {
        op = { insert: { image: node.url } };
        if (node.alt) {
          op = { ...op, attributes: { alt: node.alt } };
        }
      } else if (node.type === "link") {
        const text = visitChildren(node, op);
        op = { ...text, attributes: { ...op.attributes, link: node.url } };
      } else if (node.type === "inlineCode") {
        op = {
          insert: node.value,
          attributes: { ...op.attributes, font: "monospace" }
        };
      } else {
        throw new Error(`Unsupported node type in paragraph: ${node.type}`);
      }
      return op;
    };

    const visitChildren = (node: any, op: Op): Op[] => {
      const { children } = node;
      const ops = children.map((child: any) => visitNode(child, op));
      return ops.length === 1 ? ops[0] : ops;
    };

    for (const child of children) {
      const localOps = visitNode(child, initialOp);

      if (localOps instanceof Array) {
        flatten(localOps).forEach(op => {
          ops.push(op);
        });
      } else {
        ops.push(localOps);
      }
    }
  };

  const headingVisitor = (node: any) => {
    paragraphVisitor()(node);
    ops.push ({ insert: '\n', attributes: { header: node.depth }} );
  };

  // this is complicated because the md parser joins multi-line text into single
  // text elements "line 1\nline 2" where quill uses separate ops for each line
  // the parser alse joins sequential nested quoted lines:
  // > level 1
  // >> level 2
  // This results in a string "level 1\nlevel 2" in one paragraph entry that must
  // be split up after
  const blockquoteVisitor = (node: any, depth: number = 0) => {
    const before = ops.length; // record the index before we start adding ops for this blockquote
    for (const child of node.children) {
      if (child.type === 'blockquote') {
        blockquoteVisitor(child, depth + 1);
      } else if (child.type === 'paragraph') {
        paragraphVisitor()(child);
      }
      
      // add the blockquote marker if there is not one already in place
      // there can be one if the blockquote is indented multiple times
      // without quoted content at each level:
      // >>> level 3
      // This parses to a hierarchy of {bq: bq: bq: para: level 3}
      if (!ops[ops.length-1]?.attributes?.blockquote) {
        let op: any = { insert: '\n', attributes: { blockquote: true }};
        if (depth > 0) {
          op.attributes.indent = depth;
        }
        ops.push (op);
      }

      // expand any multi-line quoted text into multiple ops
      for (let x = ops.length - 1; x >= before; x--) {
        if (typeof ops[x].insert === 'string') {
          let str = ops[x].insert?.toString();
          if (str !== '\n' && str?.includes('\n')) { // quoted text with multiple lines
            let parts = str.split ('\n');
            let delta = ops[x+1]; // the delta kthat follows this multiline text
            let remove = 1;
            if (delta?.attributes?.blockquote) { // if the following delta is a blockquote marker, we replace it
              remove = 2;
            }
            let qOps: any[] = parts.map ((line: string, idx: number) => {
              let newOps: any[] = [{ insert: line }];
              let newIndent = Math.max ((delta?.attributes?.indent || 0) - idx, 0);
              // if this is not the last line or this delta is followed by a blockquote delta
              // then we need to include a blockquote delta
              if (idx < parts.length-1 || remove === 2) {
                let op: any = { insert: '\n', attributes: { blockquote: true } };
                if (newIndent > 0) {
                  op.attributes.indent = newIndent;
                }
                newOps.push (op);
              }
              return newOps;
            });
            console.log ('Created new ops', JSON.stringify ({qOps, x, ops, remove}, null, 2));
            ops.splice(x, remove, ...flatten(qOps));
          }
        }
      }
    }
  }

  for (let idx = 0; idx < tree.children.length; idx++) {
    const child = tree.children[idx];
    const nextType: string =
      idx + 1 < tree.children.length ? tree.children[idx + 1].type : "lastOne";

    if (child.type === "paragraph") {
      paragraphVisitor()(child);

      if (
        nextType === "paragraph" ||
        nextType === "code" ||
        nextType === "heading" /*||
        nextType === "blockquote"*/
      ) {
        addNewline();
        addNewline();
      } else if (nextType === "lastOne" || nextType === "list") {
        addNewline();
      }
    } else if (child.type === "list") {
      listVisitor(child);
      if (nextType === "list") {
        addNewline();
      }
    } else if (child.type === "code") {
      ops.push({ insert: child.value });
      ops.push({ insert: "\n", attributes: { "code-block": true } });

      if (nextType === "paragraph" || nextType === "lastOne") {
        addNewline();
      }
    } else if (child.type === "heading") {
      console.log ('heading', JSON.stringify({child}, null, 2));
      headingVisitor(child);
    } else if (child.type === 'blockquote') {
      console.log ('blockquote', JSON.stringify({child}, null, 2));
      blockquoteVisitor(child);
    } else {
      throw new Error(`Unsupported child type: ${child.type}`);
    }
  }

  return ops;
}
