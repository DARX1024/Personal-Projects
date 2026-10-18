from pathlib import Path
import sqlite3,sys,unittest
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
import intake_reader as reader

class MetadataLayout(unittest.TestCase):
    def check_entry(self,source,target,oneshot,xml_series,*,preserve=False):
        r=reader.Reader({'enabled':True});r.connection=sqlite3.connect(':memory:')
        r.connection.executescript('CREATE TABLE BOOK(ID TEXT,SERIES_ID TEXT,oneshot INTEGER); CREATE TABLE SERIES_METADATA(SERIES_ID TEXT,TITLE TEXT);')
        r.connection.execute('INSERT INTO BOOK VALUES (?,?,?)',('book','series',oneshot))
        r.connection.execute('INSERT INTO SERIES_METADATA VALUES (?,?)',('series','Existing Folder'))
        op={'book_id':'book','source':source,'target':target,'series':xml_series,'title':'Title','xml':'<ComicInfo/>'}
        if preserve:op['preserve_reader_layout']=True
        with patch.object(reader.native,'apply_plan',return_value={'affected_series_ids':[]}) as apply:
            r.apply([op]);entry=apply.call_args.args[1][0]
        r.connection.close();return entry
    def test_unscoped_xml_in_series_folder_preserves_layout(self):
        e=self.check_entry('E:/Library/Collection/Book.cbz','E:/Library/Collection/Book.cbz',0,'')
        self.assertFalse(e['oneshot']);self.assertEqual(e['series_title'],'Existing Folder')
    def test_oneshot_metadata_update_preserves_oneshot(self):
        e=self.check_entry('E:/Library/_oneshots/Book.cbz','E:/Library/_oneshots/Book.cbz',1,'Proposed Series')
        self.assertTrue(e['oneshot'])
    def test_owner_move_can_preserve_unscoped_existing_series(self):
        e=self.check_entry('E:/Old/Collection/Book.cbz','E:/New/Collection/Book.cbz',0,'',preserve=True)
        self.assertFalse(e['oneshot']);self.assertEqual(e['series_title'],'Existing Folder')
    def test_real_archive_move_can_create_a_new_series(self):
        e=self.check_entry('E:/Library/_oneshots/Book.cbz','E:/Library/New/Book.cbz',1,'New')
        self.assertFalse(e['oneshot']);self.assertEqual(e['series_title'],'New')

if __name__=='__main__':unittest.main()
