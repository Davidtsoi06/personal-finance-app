import './Table.css';

export interface Column<T> {
  key: string;
  title: string;
  render?: (row: T) => React.ReactNode;
  className?: string;
  align?: 'left' | 'right' | 'center';
}

interface TableProps<T> {
  columns: Column<T>[];
  data: T[];
  rowKey?: (row: T) => string | number;
  emptyText?: string;
  onRowClick?: (row: T) => void;
}

export function Table<T>({ columns, data, rowKey, onRowClick, emptyText = '暂无数据' }: TableProps<T>) {
  const getRowKey = rowKey || ((row: any) => row.id);

  if (data.length === 0) {
    return <div className="table-empty">{emptyText}</div>;
  }

  return (
    <div className="table-wrapper">
      <table className="table">
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col.key} className={`table-th ${col.className || ''}`} style={{ textAlign: col.align || 'left' }}>
                {col.title}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row) => (
            <tr key={getRowKey(row)} className="table-row" onClick={() => onRowClick?.(row)} style={{ cursor: onRowClick ? 'pointer' : undefined }}>
              {columns.map((col) => (
                <td key={col.key} className={`table-td ${col.className || ''}`} style={{ textAlign: col.align || 'left' }}>
                  {col.render ? col.render(row) : (row as any)[col.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
