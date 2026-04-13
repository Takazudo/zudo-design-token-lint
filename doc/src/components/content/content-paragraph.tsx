type Props = {
  children?: React.ReactNode;
  [key: string]: any;
};

export function ContentParagraph({ children, ...rest }: Props) {
  return <p {...rest}>{children}</p>;
}
