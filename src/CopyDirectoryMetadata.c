/* Restore metadata for copied directories, including the pre-existing volume
 * root. Only two distinct HFS volume roots are accepted; source must be read-only.
 * Never follows a link, crosses a filesystem, creates a directory or copies data.
 * Callers must verify the complete copied tree after this helper succeeds. */
#include <sys/types.h>
#include <sys/stat.h>
#include <sys/mount.h>
#include <copyfile.h>
#include <fts.h>
#include <fcntl.h>
#include <unistd.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <errno.h>
#include <limits.h>

static struct stat roots[2];static const char *paths[2];static int fds[2];
static void fail(const char *message,const char *path){fprintf(stderr,"%s: %s (%s)\n",message,path,strerror(errno));exit(1);}
static int same(const struct stat *a,const struct stat *b){return a->st_dev==b->st_dev && a->st_ino==b->st_ino && S_ISDIR(b->st_mode);}
static int excluded(const char *p){return !strcmp(p,".fseventsd") || !strcmp(p,".Spotlight-V100") || !strcmp(p,".Trashes") || !strcmp(p,".TemporaryItems");}
static void guard(void){
    for(int i=0;i<2;i++){
        struct stat named,opened;struct statfs fs;
        if(lstat(paths[i],&named) || fstat(fds[i],&opened) || fstatfs(fds[i],&fs))fail("Cannot inspect volume",paths[i]);
        if(!same(&roots[i],&named) || !same(&roots[i],&opened) || strcmp(fs.f_fstypename,"hfs") ||
            ((fs.f_flags&MNT_RDONLY)!=0)!=(i==0)){errno=ESTALE;fail("Volume identity/access changed",paths[i]);}
    }
}
static int directory(int which,const char *relative){
    int fd=dup(fds[which]);if(fd<0)fail("Cannot hold volume",paths[which]);
    char *copy=strdup(relative);if(!copy)fail("Allocation failed",relative);
    char *context=NULL,*part=strtok_r(copy,"/",&context);
    while(part){
        if(!strcmp(part,".") || !strcmp(part,"..")){errno=EINVAL;fail("Unsafe directory name",relative);}
        int next=openat(fd,part,O_RDONLY|O_DIRECTORY|O_NOFOLLOW);struct stat st;
        if(next<0 || fstat(next,&st))fail("Missing or linked copied directory",relative);
        if(st.st_dev!=roots[which].st_dev){errno=EXDEV;fail("Nested filesystem",relative);}
        close(fd);fd=next;part=strtok_r(NULL,"/",&context);
    }
    free(copy);return fd;
}
int main(int argc,char **argv){
    if(argc!=3 || geteuid()!=0){fprintf(stderr,"Usage (as root): CopyDirectoryMetadata /readonly-hfs-root /writable-hfs-root\n");return 64;}
    struct stat host;if(stat("/",&host))fail("Cannot inspect host root","/");
    for(int i=0;i<2;i++){
        paths[i]=argv[i+1];char resolved[PATH_MAX];
        if(paths[i][0]!='/' || !realpath(paths[i],resolved) || strcmp(resolved,paths[i]) || !strcmp(resolved,"/")){errno=EINVAL;fail("Expected a canonical volume root",paths[i]);}
        fds[i]=open(paths[i],O_RDONLY|O_DIRECTORY|O_NOFOLLOW);
        if(fds[i]<0 || fstat(fds[i],&roots[i]))fail("Cannot open volume root",paths[i]);
        char parent[PATH_MAX];snprintf(parent,sizeof(parent),"%s/..",paths[i]);struct stat p;
        if(stat(parent,&p))fail("Cannot inspect volume parent",paths[i]);
        if(p.st_dev==roots[i].st_dev || host.st_dev==roots[i].st_dev){errno=EINVAL;fail("Expected a separately mounted HFS volume",paths[i]);}
    }
    if(roots[0].st_dev==roots[1].st_dev){errno=EINVAL;fail("Source and destination must differ",paths[1]);}guard();
    char *names[]={(char*)paths[0],NULL};FTS *walk=fts_open(names,FTS_PHYSICAL|FTS_XDEV|FTS_NOCHDIR,NULL);
    if(!walk)fail("Cannot traverse source",paths[0]);FTSENT *entry;unsigned long count=0;errno=0;
    while((entry=fts_read(walk))){
        if(entry->fts_info==FTS_ERR || entry->fts_info==FTS_DNR || entry->fts_info==FTS_NS || entry->fts_info==FTS_DC){errno=entry->fts_errno;fail("Cannot traverse source",entry->fts_path);}
        if(entry->fts_statp->st_dev!=roots[0].st_dev){errno=EXDEV;fail("Source contains a nested filesystem",entry->fts_path);}
        if(entry->fts_level==1 && excluded(entry->fts_name)){if(entry->fts_info==FTS_D && fts_set(walk,entry,FTS_SKIP))fail("Cannot skip volume-local state",entry->fts_path);continue;}
        if(entry->fts_info!=FTS_DP){errno=0;continue;}
        guard();const char *relative=entry->fts_level?entry->fts_path+strlen(paths[0])+1:"";
        int source=directory(0,relative),target=directory(1,relative);struct stat before,after;
        if(fstat(source,&before) || !same(entry->fts_statp,&before)){errno=ESTALE;fail("Source directory changed",relative);}
        if(fcopyfile(source,target,NULL,COPYFILE_METADATA))fail("Cannot preserve directory metadata",relative);
        if(fstat(target,&after))fail("Cannot inspect copied directory",relative);
        if((before.st_mode&07777)!=(after.st_mode&07777) || before.st_uid!=after.st_uid || before.st_gid!=after.st_gid ||
            before.st_flags!=after.st_flags || before.st_mtimespec.tv_sec!=after.st_mtimespec.tv_sec || before.st_mtimespec.tv_nsec!=after.st_mtimespec.tv_nsec){errno=EIO;fail("Directory metadata readback differs",relative);}
        close(source);close(target);count++;errno=0;
    }
    if(errno)fail("Cannot finish directory traversal",paths[0]);if(fts_close(walk))fail("Cannot close source traversal",paths[0]);guard();
    close(fds[0]);close(fds[1]);printf("{\"completed\":true,\"directories\":%lu,\"contentCopied\":false}\n",count);return 0;
}
