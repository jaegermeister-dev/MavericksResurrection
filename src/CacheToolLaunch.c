/* Execute the selected Mavericks installation's own kextcache with fixed
 * explicit target paths. Only a private cache output directory is writable.
 * No formatting, driver loading, system-cache mode or caller environment. */
#include <CommonCrypto/CommonDigest.h>
#include <sys/stat.h>
#include <sys/mount.h>
#include <sandbox.h>
#include <fcntl.h>
#include <unistd.h>
#include <limits.h>
#include <stdlib.h>
#include <stdio.h>
#include <string.h>
#include <errno.h>

static void stop(const char *s){fprintf(stderr,"MavericksResurrection cache tool: %s (%d)\n",s,errno);exit(70);}
static unsigned long long number(const char *s){char *end;errno=0;if(!s||!*s||strspn(s,"0123456789")!=strlen(s))stop("Invalid identity");unsigned long long n=strtoull(s,&end,10);if(errno||*end)stop("Invalid identity");return n;}
static void canonical(const char *p){char resolved[PATH_MAX];if(!realpath(p,resolved)||strcmp(p,resolved))stop("Expected a canonical path");for(const unsigned char *c=(const unsigned char*)p;*c;c++)if(*c<32||*c==127)stop("Control character in path");}
static void join(char *out,const char *p,const char *name){if(snprintf(out,PATH_MAX,"%s/%s",p,name)>=PATH_MAX)stop("Path is too long");}
static void file(const char *p){struct stat s;canonical(p);if(lstat(p,&s)||!S_ISREG(s.st_mode)||s.st_uid||s.st_nlink!=1||(s.st_mode&0022))stop("Unprotected cache input");}
static void hash(const char *path,const char *expected){
    if(strlen(expected)!=64||strspn(expected,"0123456789abcdef")!=64)stop("Invalid expected tool hash");int fd=open(path,O_RDONLY|O_NOFOLLOW);struct stat before,after;
    if(fd<0||fstat(fd,&before))stop("Cannot open current Mavericks tool");CC_SHA256_CTX c;CC_SHA256_Init(&c);unsigned char buf[65536],digest[32];ssize_t n;
    while((n=read(fd,buf,sizeof buf))!=0){if(n<0){if(errno==EINTR)continue;stop("Cannot hash Mavericks tool");}CC_SHA256_Update(&c,buf,(CC_LONG)n);}
    if(fstat(fd,&after)||before.st_dev!=after.st_dev||before.st_ino!=after.st_ino||before.st_size!=after.st_size||before.st_mtimespec.tv_sec!=after.st_mtimespec.tv_sec||before.st_mtimespec.tv_nsec!=after.st_mtimespec.tv_nsec||before.st_ctimespec.tv_sec!=after.st_ctimespec.tv_sec||before.st_ctimespec.tv_nsec!=after.st_ctimespec.tv_nsec)stop("Mavericks tool changed");close(fd);
    char encoded[65];CC_SHA256_Final(digest,&c);for(unsigned i=0;i<32;i++)sprintf(encoded+2*i,"%02x",digest[i]);if(strcmp(encoded,expected))stop("Mavericks tool checksum differs");
}
static void quote(const char *s,char *out,size_t capacity){size_t n=0;while(*s){if(n+3>=capacity)stop("Sandbox path too long");if(*s=='"'||*s=='\\')out[n++]='\\';out[n++]=*s++;}out[n]=0;}
int main(int argc,char **argv){
    if(geteuid()||argc<8||argc>4105)return 64;
    const char *root=argv[1],*work=argv[4],*expected=argv[5],*operation=argv[6],*filename=argv[7];
    int prelink=!strcmp(operation,"prelink"),compress=!strcmp(operation,"compress"),uncompress=!strcmp(operation,"uncompress");
    if((!prelink&&!compress&&!uncompress)||(!prelink&&argc!=8))return 64;
    if((prelink&&strcmp(filename,"uncompressed"))||(compress&&strcmp(filename,"compressed"))||(uncompress&&strcmp(filename,"roundtrip")&&strcmp(filename,"inspection")))return 64;
    canonical(root);canonical(work);struct stat r,w,host;struct statfs fs;
    int rootFD=open(root,O_RDONLY|O_DIRECTORY|O_NOFOLLOW);
    if(rootFD<0||fstat(rootFD,&r)||fstatfs(rootFD,&fs)||stat("/",&host)||!S_ISDIR(r.st_mode)||host.st_dev==r.st_dev||strcmp(fs.f_fstypename,"hfs")||strcmp(fs.f_mntonname,root)||(unsigned long long)r.st_dev!=number(argv[2])||(unsigned long long)r.st_ino!=number(argv[3]))stop("Offline Mavericks root changed");
    if(lstat(work,&w)||!S_ISDIR(w.st_mode)||w.st_uid||(w.st_mode&0777)!=0700||!strcmp(root,work))stop("Private cache output directory is required");
    char tool[PATH_MAX],output[PATH_MAX],kernel[PATH_MAX],system[PATH_MAX],library[PATH_MAX];
    join(tool,root,"usr/sbin/kextcache");join(kernel,root,"mach_kernel");join(output,work,filename);join(system,root,"System/Library/Extensions");join(library,root,"Library/Extensions");file(tool);file(kernel);hash(tool,expected);canonical(system);canonical(library);
    if(prelink){struct stat s;if(lstat(output,&s)==0||errno!=ENOENT)stop("Cache output already exists");}else file(output);
    char **args=calloc((size_t)argc*2+24,sizeof(char*));if(!args)stop("Cannot allocate cache arguments");unsigned at=0;
    args[at++]=tool;args[at++]="-prelinked-kernel";args[at++]=output;
    if(!prelink)args[at++]=compress?"-compressed":"-uncompressed";
    else{
        args[at++]="-uncompressed";args[at++]="-arch";args[at++]="x86_64";args[at++]="-kernel";args[at++]=kernel;args[at++]="-volume-root";args[at++]=(char*)root;args[at++]="-print-diagnostics";args[at++]="-verbose";args[at++]="3";
        if(argc==8)stop("Explicit cache bundle selection is required");
        for(int i=8;i<argc;i++){if(!argv[i][0]||strlen(argv[i])>255||strspn(argv[i],"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789._-")!=strlen(argv[i]))stop("Invalid bundle identifier");args[at++]="-bundle-id";args[at++]=argv[i];}
        args[at++]="--";args[at++]=system;args[at++]=library;
    }
    char escaped[PATH_MAX*2+1],profile[PATH_MAX*2+400],canary[PATH_MAX];quote(work,escaped,sizeof escaped);
    if(snprintf(profile,sizeof profile,"(version 1)(allow default)(deny file-write*)(allow file-write* (subpath \"%s\"))(allow file-write-data (literal \"/dev/null\"))(deny network*)",escaped)>=(int)sizeof profile)stop("Cache sandbox profile too long");
    char *error=NULL;if(sandbox_init(profile,0,&error)){fprintf(stderr,"Cannot confine cache tool: %s\n",error?error:"unknown");return 70;}
    join(canary,root,"mavericksresurrection-cache-write-must-be-denied");int forbidden=open(canary,O_CREAT|O_EXCL|O_WRONLY,0600);
    if(forbidden>=0||(errno!=EPERM&&errno!=EACCES)){if(forbidden>=0)close(forbidden);stop("Cache write boundary failed");}
    fprintf(stderr,"GM_CACHE_WRITES_CONFINED\n");
    char *env[]={"PATH=/usr/bin:/bin:/usr/sbin:/sbin","HOME=/var/root","LANG=C","LC_ALL=C","_com_apple_kextd_skiplocks=1",NULL};
    alarm(600);execve(tool,args,env);stop("Cannot start Mavericks cache tool");
}
