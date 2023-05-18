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
    console.log ('listItemVisitor', JSON.stringify({children: node.children.length, listNode}, null, 2));
    for (const child of node.children) {
      console.log ('LIST CHILD NODE', JSON.stringify({child}, null, 2));
      if (child.type === "paragraph") {
        visit(child, "paragraph", paragraphVisitor());
      } else if (child.type === "list") {
        continue
      }

      let indent = 0;
      console.log ('INDENT', JSON.stringify({start: child.position.start.column, indent}, null, 2));
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
      console.log ('> listItem child push', JSON.stringify({ops, delta}, null, 2));
      ops.push(delta);
    }
  };

  const paragraphVisitor = (initialOp: Op = {}, custom: CustomAction[] = []) => (node: any) => {
    console.log ('paragraphVisitor', JSON.stringify({node}, null, 2));
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
          console.log ('> paragraphFlattened push', JSON.stringify({op}, null, 2));
          ops.push(op);
        });
      } else {
        console.log ('> paragraph push local', JSON.stringify({localOps}, null, 2));
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
  // this makes using the existing paragraphVisitor code hard to use becasue it
  // doesn't know how to do something different per line of text
  const blockquoteVisitor = (node: any, depth: number = 0) => {
    const before = ops.length;
    let closed: boolean = false;
    for (const child of node.children) {
      if (child.type === 'blockquote') {
        console.log('ops before inner BQ', ops);
        let op: any = { insert: '\n', attributes: { blockquote: true }};
        if (depth > 0) {
          op.attributes.indent = depth;
        }
        ops.push (op);
        
        //ops.push ( );
        closed = true;
        blockquoteVisitor(child, depth + 1);
        console.log('ops after inner BQ', ops);
      } else {
        paragraphVisitor()(child);
      }
    }

    // find entries where the blockquote text is a multiline string and
    // replace them with multiple ops to match how Quill expects it
    for (let x = ops.length - 1; x >= before; x--) {
      if (typeof ops[x].insert === 'string') {
        let str = ops[x].insert?.toString();
        if (str !== '\n' && str?.includes('\n')) { // quoted text with multiple lines
          let parts = str.split ('\n');
          let qOps: any[] = parts.map ((line: string, idx: number) => {
            let newOps: any[] = [{ insert: line }];
            console.log ('check if adding close', {x, idx, parts});
            if (idx < parts.length-1 || ops[x+idx]?.attributes?.blockquote) {
              let op: any = { insert: '\n', attributes: { blockquote: true } };
              if (depth > 0) {
                op.attributes.indent = depth;
                depth--;
              }
              newOps.push (op);
              closed = true;
            }
            return newOps;
          });
          let remove = 1;
          if (ops[x+1]?.attributes?.blockquote) {
            remove = 2;
          }
          console.log ('Created new ops', JSON.stringify ({qOps, x, ops, remove}, null, 2));
          ops.splice(x, remove, ...flatten(qOps));
        }
      }
    }
    
    if (!ops[ops.length-1]?.attributes?.blockquote) {
      let op: any = { insert: '\n', attributes: { blockquote: true }};
      if (depth > 0) {
        op.attributes.indent = depth;
        //depth--;
      }
      ops.push (op);
    }

    /*
    for (const child of node.children) {
      console.log ('blockquote child', child.type, child.type == 'paragraph', JSON.stringify({child}, null, 2));
      if (child.type === "paragraph") {
        function testFactory (parent: any) {
          return (node: any, op: any): boolean => {
            console.log ('Running test', {parent, node});
            if (parent.children.includes(child)) {
              console.log ('MATCHED', child);
              return child.type === "text";
            }
            return false;
          }
        }

        paragraphVisitor({}, [
          new CustomAction(
            testFactory (child),
            (node: any, op: any) => {
              console.log ('>> Running custom text handler:', node.value);
              let parts = node.value.split ('\n');
              return parts.map ((line: string) => {
                return [
                  { insert: line },
                  { insert: '\n', attributes: { blockquote: true }}
                ]
              })
            }
          )
        ])(child);*/
        /*  { // add custom text handler to split lines
          "text": (node: any, op: any) => {
            console.log ('>> Running custom text handler:', node.value);
            let parts = node.value.split ('\n');
            return parts.map ((line: string) => {
              return [
                { insert: line },
                { insert: '\n', attributes: { blockquote: true }}
              ]
            })
          }
        })(child);*/
      /*}
    }*/
  };

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
